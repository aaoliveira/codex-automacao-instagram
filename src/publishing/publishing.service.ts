import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import {
  InstagramAccount,
  Prisma,
  Publication,
  PublicationStatus,
} from "@prisma/client";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { CreatePublicationDto } from "./dto/create-publication.dto";
import { PublicationsQueryDto } from "./dto/publications-query.dto";
import { QueueJobState, QueueJobsQueryDto } from "./dto/queue-jobs-query.dto";
import { SchedulePublicationDto } from "./dto/schedule-publication.dto";
import {
  INSTAGRAM_PUBLICATION_JOB,
  INSTAGRAM_PUBLICATION_QUEUE,
  PUBLICATION_MAX_ATTEMPTS,
  PUBLICATION_RETRY_DELAY_MS,
} from "./publication.constants";
import {
  INSTAGRAM_PUBLISHING_PROVIDER,
  InstagramPublishingProvider,
} from "./instagram-publishing-provider";
import { resolvePublicationSchedule } from "./publication-schedule";

interface PublicationJobData {
  publicationId: string;
  organizationId: string;
}

type PublicationWithAccount = Publication & {
  instagramAccount: Pick<
    InstagramAccount,
    "id" | "provider" | "status" | "username" | "name"
  >;
};

@Injectable()
export class PublishingService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(INSTAGRAM_PUBLICATION_QUEUE)
    private readonly queue: Queue<PublicationJobData>,
    @Inject(INSTAGRAM_PUBLISHING_PROVIDER)
    private readonly provider: InstagramPublishingProvider,
  ) {}

  async createDraft(
    organizationId: string,
    dto: CreatePublicationDto,
  ) {
    if (dto.mediaAssetId && dto.mediaUrl) {
      throw new BadRequestException("Choose either a media URL or a media asset");
    }
    if (!dto.mediaAssetId && !dto.mediaUrl) {
      throw new BadRequestException("A media URL or media asset is required");
    }
    if (
      dto.altText !== undefined &&
      dto.mediaType !== "PHOTO"
    ) {
      throw new BadRequestException("Alt text is supported only for photos");
    }
    if (
      dto.shareToFeed !== undefined &&
      dto.mediaType !== "REEL"
    ) {
      throw new BadRequestException("shareToFeed is supported only for Reels");
    }

    if (dto.idempotencyKey) {
      const existing = await this.prisma.publication.findFirst({
        where: {
          organizationId,
          idempotencyKey: dto.idempotencyKey,
        },
        include: { instagramAccount: true },
      });
      if (existing) {
        this.assertSameRequest(existing, dto);
        return this.toPublic(existing);
      }
    }

    const account = await this.prisma.instagramAccount.findFirst({
      where: {
        id: dto.instagramAccountId,
        organizationId,
        status: "CONNECTED",
        externalAccountId: { not: null },
      },
      select: { id: true },
    });
    if (!account) throw new NotFoundException("Connected Instagram account not found");

    if (dto.mediaAssetId) {
      const asset = await this.prisma.mediaAsset.findFirst({
        where: { id: dto.mediaAssetId, organizationId },
        select: { id: true, mediaKind: true },
      });
      if (!asset) throw new NotFoundException("Media asset not found");
      const expectedKind = dto.mediaType === "PHOTO" ? "IMAGE" : "VIDEO";
      if (asset.mediaKind !== expectedKind) {
        throw new BadRequestException(
          `This ${dto.mediaType.toLowerCase()} publication requires ${expectedKind.toLowerCase()} media`,
        );
      }
    }

    try {
      const publication = await this.prisma.publication.create({
        data: {
          organizationId,
          instagramAccountId: account.id,
          idempotencyKey: dto.idempotencyKey,
          mediaType: dto.mediaType,
          mediaUrl: dto.mediaUrl ?? null,
          mediaAssetId: dto.mediaAssetId ?? null,
          caption: dto.caption ?? null,
          altText: dto.altText ?? null,
          shareToFeed: dto.shareToFeed ?? null,
          status: PublicationStatus.DRAFT,
        },
        include: { instagramAccount: true },
      });
      return this.toPublic(publication);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        dto.idempotencyKey
      ) {
        const existing = await this.prisma.publication.findFirst({
          where: { organizationId, idempotencyKey: dto.idempotencyKey },
          include: { instagramAccount: true },
        });
        if (existing) {
          this.assertSameRequest(existing, dto);
          return this.toPublic(existing);
        }
      }
      throw error;
    }
  }

  async publishNow(organizationId: string, publicationId: string) {
    const publication = await this.findOne(organizationId, publicationId);
    if (
      publication.status === PublicationStatus.QUEUED ||
      publication.status === PublicationStatus.PROCESSING ||
      publication.status === PublicationStatus.PUBLISHED
    ) {
      return this.toPublic(publication);
    }
    if (publication.status !== PublicationStatus.DRAFT) {
      throw new ConflictException("Only a draft can be published");
    }
    if (publication.instagramAccount.status !== "CONNECTED") {
      throw new ConflictException("Instagram account is not connected");
    }
    if (publication.instagramAccount.provider !== this.provider.type) {
      throw new ConflictException(
        "The configured Instagram provider does not match this account",
      );
    }

    const queuedAt = new Date();
    const changed = await this.prisma.publication.updateMany({
      where: {
        id: publicationId,
        organizationId,
        status: PublicationStatus.DRAFT,
      },
      data: {
        status: PublicationStatus.QUEUED,
        queuedAt,
        errorCode: null,
        errorMessage: null,
      },
    });
    if (changed.count !== 1) {
      const current = await this.findOne(organizationId, publicationId);
      if (
        current.status === PublicationStatus.QUEUED ||
        current.status === PublicationStatus.PROCESSING ||
        current.status === PublicationStatus.PUBLISHED
      ) {
        return this.toPublic(current);
      }
      throw new ConflictException("Publication is no longer a draft");
    }

    try {
      await this.enqueuePublication(publicationId, organizationId);
    } catch {
      await this.prisma.publication.updateMany({
        where: {
          id: publicationId,
          organizationId,
          status: PublicationStatus.QUEUED,
        },
        data: {
          status: PublicationStatus.DRAFT,
          queuedAt: null,
        },
      });
      throw new ServiceUnavailableException(
        "Publication could not be added to the processing queue",
      );
    }

    return this.findAndProject(organizationId, publicationId);
  }

  async schedule(
    organizationId: string,
    publicationId: string,
    dto: SchedulePublicationDto,
  ) {
    const current = await this.findOne(organizationId, publicationId);
    if (current.status === PublicationStatus.QUEUED) {
      const schedule = resolvePublicationSchedule(
        dto.scheduledAt,
        dto.timezone,
        new Date(),
        false,
      );
      if (
        current.scheduledAt?.getTime() === schedule.scheduledAt.getTime() &&
        current.scheduleTimezone === schedule.timezone
      ) {
        const existingJob = await this.queue.getJob(
          publicationJobId(publicationId),
        );
        if (!existingJob) {
          await this.enqueuePublication(
            publicationId,
            organizationId,
            schedule.delayMs,
          );
        }
        return this.toPublic(current);
      }
      throw new ConflictException(
        "Publication is already queued with a different schedule",
      );
    }
    const schedule = resolvePublicationSchedule(dto.scheduledAt, dto.timezone);
    if (current.status !== PublicationStatus.DRAFT) {
      throw new ConflictException("Only a draft can be scheduled");
    }
    this.assertAccountCanPublish(current);

    const queuedAt = new Date();
    const changed = await this.prisma.publication.updateMany({
      where: {
        id: publicationId,
        organizationId,
        status: PublicationStatus.DRAFT,
      },
      data: {
        status: PublicationStatus.QUEUED,
        queuedAt,
        scheduledAt: schedule.scheduledAt,
        scheduleTimezone: schedule.timezone,
        errorCode: null,
        errorMessage: null,
      },
    });
    if (changed.count !== 1) {
      const latest = await this.findOne(organizationId, publicationId);
      if (
        latest.status === PublicationStatus.QUEUED &&
        latest.scheduledAt?.getTime() === schedule.scheduledAt.getTime() &&
        latest.scheduleTimezone === schedule.timezone
      ) {
        return this.toPublic(latest);
      }
      throw new ConflictException("Publication is no longer a draft");
    }

    try {
      await this.enqueuePublication(
        publicationId,
        organizationId,
        schedule.delayMs,
      );
    } catch {
      await this.prisma.publication.updateMany({
        where: {
          id: publicationId,
          organizationId,
          status: PublicationStatus.QUEUED,
          scheduledAt: schedule.scheduledAt,
        },
        data: {
          status: PublicationStatus.DRAFT,
          queuedAt: null,
          scheduledAt: null,
          scheduleTimezone: null,
        },
      });
      throw new ServiceUnavailableException(
        "Scheduled publication could not be added to the queue",
      );
    }

    return this.findAndProject(organizationId, publicationId);
  }

  async cancel(organizationId: string, publicationId: string) {
    const current = await this.findOne(organizationId, publicationId);
    if (current.status === PublicationStatus.CANCELED) {
      return this.toPublic(current);
    }
    if (
      current.status !== PublicationStatus.DRAFT &&
      current.status !== PublicationStatus.QUEUED
    ) {
      throw new ConflictException(
        "Publication can no longer be canceled after processing starts",
      );
    }

    const canceledAt = new Date();
    const changed = await this.prisma.publication.updateMany({
      where: {
        id: publicationId,
        organizationId,
        status: {
          in: [PublicationStatus.DRAFT, PublicationStatus.QUEUED],
        },
      },
      data: {
        status: PublicationStatus.CANCELED,
        canceledAt,
        processingStartedAt: null,
      },
    });
    if (changed.count !== 1) {
      const latest = await this.findOne(organizationId, publicationId);
      if (latest.status === PublicationStatus.CANCELED) {
        return this.toPublic(latest);
      }
      throw new ConflictException(
        "Publication can no longer be canceled after processing starts",
      );
    }

    const job = await this.queue.getJob(publicationJobId(publicationId));
    if (job) {
      const state = await job.getState();
      if (state !== "active" && state !== "completed") {
        await job.remove().catch(() => undefined);
      }
    }
    return this.findAndProject(organizationId, publicationId);
  }

  async retryFailed(organizationId: string, publicationId: string) {
    const current = await this.findOne(organizationId, publicationId);
    if (current.status === PublicationStatus.PROCESSING) {
      return this.toPublic(current);
    }
    if (current.status === PublicationStatus.QUEUED) {
      const queuedJob = await this.queue.getJob(
        publicationJobId(publicationId),
      );
      if (queuedJob && (await queuedJob.getState()) === "failed") {
        try {
          await this.prisma.publication.updateMany({
            where: {
              id: publicationId,
              organizationId,
              status: PublicationStatus.QUEUED,
            },
            data: {
              queuedAt: new Date(),
              errorCode: null,
              errorMessage: null,
            },
          });
          await queuedJob.retry("failed", {
            resetAttemptsMade: true,
            resetAttemptsStarted: true,
          });
        } catch {
          if ((await queuedJob.getState()) !== "failed") {
            return this.findAndProject(organizationId, publicationId);
          }
          await this.prisma.publication.updateMany({
            where: {
              id: publicationId,
              organizationId,
              status: PublicationStatus.QUEUED,
            },
            data: {
              status: PublicationStatus.FAILED,
              errorCode: "MANUAL_RETRY_COULD_NOT_BE_QUEUED",
              errorMessage: "The failed queue job could not be retried.",
            },
          });
          throw new ServiceUnavailableException(
            "Failed publication could not be retried",
          );
        }
        return this.findAndProject(organizationId, publicationId);
      }
      return this.toPublic(current);
    }
    if (current.status !== PublicationStatus.FAILED) {
      throw new ConflictException("Only a failed publication can be retried");
    }

    const job = await this.queue.getJob(publicationJobId(publicationId));
    if (!job || (await job.getState()) !== "failed") {
      throw new ConflictException(
        "The failed queue job is no longer available for manual retry",
      );
    }

    const changed = await this.prisma.publication.updateMany({
      where: {
        id: publicationId,
        organizationId,
        status: PublicationStatus.FAILED,
      },
      data: {
        status: PublicationStatus.QUEUED,
        queuedAt: new Date(),
        processingStartedAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });
    if (changed.count !== 1) {
      const latest = await this.findOne(organizationId, publicationId);
      if (
        latest.status === PublicationStatus.QUEUED ||
        latest.status === PublicationStatus.PROCESSING
      ) {
        return this.toPublic(latest);
      }
      throw new ConflictException("Publication is no longer failed");
    }

    try {
      await job.retry("failed", {
        resetAttemptsMade: true,
        resetAttemptsStarted: true,
      });
    } catch {
      await this.prisma.publication.updateMany({
        where: {
          id: publicationId,
          organizationId,
          status: PublicationStatus.QUEUED,
        },
        data: {
          status: PublicationStatus.FAILED,
          errorCode: "MANUAL_RETRY_COULD_NOT_BE_QUEUED",
          errorMessage: "The failed queue job could not be retried.",
        },
      });
      throw new ServiceUnavailableException(
        "Failed publication could not be retried",
      );
    }

    return this.findAndProject(organizationId, publicationId);
  }

  async list(organizationId: string, query: PublicationsQueryDto) {
    const where: Prisma.PublicationWhereInput = {
      organizationId,
      ...(query.instagramAccountId
        ? { instagramAccountId: query.instagramAccountId }
        : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, publications] = await this.prisma.$transaction([
      this.prisma.publication.count({ where }),
      this.prisma.publication.findMany({
        where,
        include: { instagramAccount: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: publications.map((publication) => this.toPublic(publication)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async get(organizationId: string, publicationId: string) {
    return this.toPublic(await this.findOne(organizationId, publicationId));
  }

  async listJobs(organizationId: string, query: QueueJobsQueryDto) {
    const publicationStatuses: PublicationStatus[] = query.state
      ? publicationStatusesForJobState(query.state)
      : [
          PublicationStatus.QUEUED,
          PublicationStatus.PROCESSING,
          PublicationStatus.PUBLISHED,
          PublicationStatus.FAILED,
          PublicationStatus.CANCELED,
        ];
    const where: Prisma.PublicationWhereInput = {
      organizationId,
      status: { in: publicationStatuses },
    };
    const [total, publications] = await this.prisma.$transaction([
      this.prisma.publication.count({ where }),
      this.prisma.publication.findMany({
        where,
        include: {
          instagramAccount: { select: { id: true, username: true, name: true } },
        },
        orderBy: [{ scheduledAt: "asc" }, { queuedAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    const items = await Promise.all(
      publications.map(async (publication) => {
        const jobId = publicationJobId(publication.id);
        const job = await this.queue.getJob(jobId);
        const queueState = job ? await job.getState() : "unknown";
        return {
          id: jobId,
          domain: "INSTAGRAM_PUBLICATION",
          name: INSTAGRAM_PUBLICATION_JOB,
          publicationId: publication.id,
          instagramAccountId: publication.instagramAccountId,
          instagramAccount: publication.instagramAccount,
          state: publicJobState(queueState, publication.status),
          queueState,
          attemptsMade: job?.attemptsMade ?? publication.attemptCount,
          maxAttempts: job?.opts.attempts ?? PUBLICATION_MAX_ATTEMPTS,
          scheduledAt: publication.scheduledAt,
          timezone: publication.scheduleTimezone,
          enqueuedAt: publication.queuedAt,
          startedAt: publication.processingStartedAt,
          finishedAt:
            publication.publishedAt ??
            publication.canceledAt ??
            (publication.status === PublicationStatus.FAILED
              ? publication.updatedAt
              : null),
          errorCode: publication.errorCode,
          createdAt: publication.createdAt,
          updatedAt: publication.updatedAt,
        };
      }),
    );

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async jobMetrics(organizationId: string) {
    const [waiting, processing, completed, failed, canceled] =
      await Promise.all([
        this.prisma.publication.count({
          where: { organizationId, status: PublicationStatus.QUEUED },
        }),
        this.prisma.publication.count({
          where: { organizationId, status: PublicationStatus.PROCESSING },
        }),
        this.prisma.publication.count({
          where: { organizationId, status: PublicationStatus.PUBLISHED },
        }),
        this.prisma.publication.count({
          where: { organizationId, status: PublicationStatus.FAILED },
        }),
        this.prisma.publication.count({
          where: { organizationId, status: PublicationStatus.CANCELED },
        }),
      ]);
    return {
      queue: INSTAGRAM_PUBLICATION_QUEUE,
      generatedAt: new Date(),
      states: {
        WAITING: waiting,
        PROCESSING: processing,
        COMPLETED: completed,
        FAILED: failed,
        CANCELED: canceled,
      },
      deadLetter: failed,
    };
  }

  private async findAndProject(organizationId: string, publicationId: string) {
    return this.toPublic(await this.findOne(organizationId, publicationId));
  }

  private async enqueuePublication(
    publicationId: string,
    organizationId: string,
    delay = 0,
  ) {
    await this.queue.add(
      INSTAGRAM_PUBLICATION_JOB,
      { publicationId, organizationId },
      {
        jobId: publicationJobId(publicationId),
        delay,
        attempts: PUBLICATION_MAX_ATTEMPTS,
        backoff: {
          type: "exponential",
          delay: PUBLICATION_RETRY_DELAY_MS,
        },
        removeOnComplete: { count: 5_000 },
        removeOnFail: { count: 5_000 },
      },
    );
  }

  private assertAccountCanPublish(
    publication: PublicationWithAccount,
  ): void {
    if (publication.instagramAccount.status !== "CONNECTED") {
      throw new ConflictException("Instagram account is not connected");
    }
    if (publication.instagramAccount.provider !== this.provider.type) {
      throw new ConflictException(
        "The configured Instagram provider does not match this account",
      );
    }
  }

  private findOne(organizationId: string, publicationId: string) {
    return this.prisma.publication.findFirst({
      where: { id: publicationId, organizationId },
      include: { instagramAccount: true },
    }).then((publication) => {
      if (!publication) throw new NotFoundException("Publication not found");
      return publication as PublicationWithAccount;
    });
  }

  private assertSameRequest(
    existing: Publication,
    dto: CreatePublicationDto,
  ): void {
    if (
      existing.instagramAccountId !== dto.instagramAccountId ||
      existing.mediaType !== dto.mediaType ||
      existing.mediaUrl !== (dto.mediaUrl ?? null) ||
      existing.mediaAssetId !== (dto.mediaAssetId ?? null) ||
      existing.caption !== (dto.caption ?? null) ||
      existing.altText !== (dto.altText ?? null) ||
      existing.shareToFeed !== (dto.shareToFeed ?? null)
    ) {
      throw new ConflictException(
        "Idempotency key was already used with a different publication",
      );
    }
  }

  private toPublic(publication: PublicationWithAccount) {
    return {
      id: publication.id,
      organizationId: publication.organizationId,
      instagramAccountId: publication.instagramAccountId,
      instagramAccount: {
        id: publication.instagramAccount.id,
        username: publication.instagramAccount.username,
        name: publication.instagramAccount.name,
      },
      mediaType: publication.mediaType,
      mediaAssetId: publication.mediaAssetId,
      caption: publication.caption,
      altText: publication.altText,
      shareToFeed: publication.shareToFeed,
      status: publication.status,
      externalContainerId: publication.externalContainerId,
      externalMediaId: publication.externalMediaId,
      errorCode: publication.errorCode,
      errorMessage: publication.errorMessage,
      attemptCount: publication.attemptCount,
      queuedAt: publication.queuedAt,
      scheduledAt: publication.scheduledAt,
      scheduleTimezone: publication.scheduleTimezone,
      processingStartedAt: publication.processingStartedAt,
      publishedAt: publication.publishedAt,
      canceledAt: publication.canceledAt,
      createdAt: publication.createdAt,
      updatedAt: publication.updatedAt,
    };
  }
}

export function publicationJobId(publicationId: string): string {
  return `instagram-publication-${publicationId}`;
}

function publicationStatusesForJobState(
  state: QueueJobState,
): PublicationStatus[] {
  switch (state) {
    case QueueJobState.WAITING:
      return [PublicationStatus.QUEUED];
    case QueueJobState.PROCESSING:
      return [PublicationStatus.PROCESSING];
    case QueueJobState.COMPLETED:
      return [PublicationStatus.PUBLISHED];
    case QueueJobState.FAILED:
      return [PublicationStatus.FAILED];
    case QueueJobState.CANCELED:
      return [PublicationStatus.CANCELED];
  }
}

function publicJobState(
  queueState: string,
  publicationState: PublicationStatus,
): QueueJobState {
  switch (queueState) {
    case "waiting":
    case "delayed":
    case "prioritized":
    case "paused":
    case "waiting-children":
      return QueueJobState.WAITING;
    case "active":
      return QueueJobState.PROCESSING;
    case "completed":
      return QueueJobState.COMPLETED;
    case "failed":
      return QueueJobState.FAILED;
    default:
      switch (publicationState) {
        case PublicationStatus.QUEUED:
          return QueueJobState.WAITING;
        case PublicationStatus.PROCESSING:
          return QueueJobState.PROCESSING;
        case PublicationStatus.PUBLISHED:
          return QueueJobState.COMPLETED;
        case PublicationStatus.FAILED:
          return QueueJobState.FAILED;
        case PublicationStatus.CANCELED:
          return QueueJobState.CANCELED;
        case PublicationStatus.DRAFT:
          return QueueJobState.WAITING;
      }
  }
}

