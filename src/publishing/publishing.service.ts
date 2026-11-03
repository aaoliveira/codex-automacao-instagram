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

    try {
      const publication = await this.prisma.publication.create({
        data: {
          organizationId,
          instagramAccountId: account.id,
          idempotencyKey: dto.idempotencyKey,
          mediaType: dto.mediaType,
          mediaUrl: dto.mediaUrl,
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
      await this.queue.add(
        INSTAGRAM_PUBLICATION_JOB,
        { publicationId, organizationId },
        {
          jobId: publicationJobId(publicationId),
          attempts: PUBLICATION_MAX_ATTEMPTS,
          backoff: {
            type: "exponential",
            delay: PUBLICATION_RETRY_DELAY_MS,
          },
          removeOnComplete: { count: 5_000 },
          removeOnFail: { count: 5_000 },
        },
      );
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

  private async findAndProject(organizationId: string, publicationId: string) {
    return this.toPublic(await this.findOne(organizationId, publicationId));
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
      existing.mediaUrl !== dto.mediaUrl ||
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

