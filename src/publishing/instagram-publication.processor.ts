import { Inject, Logger } from "@nestjs/common";
import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import {
  PublicationStatus,
} from "@prisma/client";
import { DelayedError, Job, Queue, UnrecoverableError } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { TokenEncryptionService } from "../instagram/token-encryption.service";
import {
  INSTAGRAM_PUBLISHING_PROVIDER,
  InstagramMediaContainerStatus,
  InstagramPublishingProvider,
  InstagramPublishingProviderError,
} from "./instagram-publishing-provider";
import {
  INSTAGRAM_PUBLICATION_QUEUE,
  PUBLICATION_MAX_ATTEMPTS,
} from "./publication.constants";
import { PUBLICATION_WORKER_CONCURRENCY } from "../shared/queue-runtime-config";
import { PublicationRateLimiter } from "./publication-rate-limiter";
import { MediaStorageService } from "../media/storage/media-storage.service";
import { AuditService } from "../audit/audit.service";

interface PublicationJobData {
  publicationId: string;
  organizationId: string;
}

const CONTAINER_STATUS_POLL_INTERVAL_MS = 60_000;
const CONTAINER_STATUS_POLL_COUNT = 5;
const WORKER_LOCK_DURATION_MS = 390_000;
const PROCESSING_LEASE_MS = 380_000;

@Processor(INSTAGRAM_PUBLICATION_QUEUE, {
  concurrency: PUBLICATION_WORKER_CONCURRENCY,
  lockDuration: WORKER_LOCK_DURATION_MS,
})
export class InstagramPublicationProcessor extends WorkerHost {
  private readonly logger = new Logger(InstagramPublicationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: TokenEncryptionService,
    @Inject(INSTAGRAM_PUBLISHING_PROVIDER)
    private readonly provider: InstagramPublishingProvider,
    @InjectQueue(INSTAGRAM_PUBLICATION_QUEUE)
    private readonly queue: Queue<PublicationJobData>,
    private readonly rateLimiter: PublicationRateLimiter,
    private readonly mediaStorage: MediaStorageService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async process(job: Job<PublicationJobData>): Promise<void> {
    const candidate = await this.prisma.publication.findFirst({
      where: {
        id: job.data.publicationId,
        organizationId: job.data.organizationId,
      },
      select: { status: true, instagramAccountId: true },
    });
    if (!candidate || candidate.status !== PublicationStatus.QUEUED) return;

    let rateLimitWaitMs: number;
    try {
      rateLimitWaitMs = await this.rateLimiter.consume(
        job.data.organizationId,
        candidate.instagramAccountId,
      );
    } catch (error) {
      if (job.attemptsMade + 1 >= PUBLICATION_MAX_ATTEMPTS) {
        await this.prisma.publication.updateMany({
          where: {
            id: job.data.publicationId,
            organizationId: job.data.organizationId,
            status: PublicationStatus.QUEUED,
          },
          data: {
            status: PublicationStatus.FAILED,
            errorCode: "PUBLICATION_RATE_LIMITER_UNAVAILABLE",
            errorMessage: "The publication queue could not apply its rate limit.",
          },
        });
      }
      throw error;
    }
    if (rateLimitWaitMs > 0) {
      if (!job.token) {
        throw new Error("A queue lock is required to delay a rate-limited job");
      }
      await job.moveToDelayed(Date.now() + rateLimitWaitMs, job.token);
      throw new DelayedError();
    }

    const now = new Date();
    const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
    const claimed = await this.prisma.publication.updateMany({
      where: {
        id: job.data.publicationId,
        organizationId: job.data.organizationId,
        OR: [
          { status: PublicationStatus.QUEUED },
          {
            status: PublicationStatus.PROCESSING,
            OR: [
              { processingStartedAt: { lt: staleBefore } },
              { processingStartedAt: null },
            ],
          },
        ],
      },
      data: {
        status: PublicationStatus.PROCESSING,
        processingStartedAt: now,
        attemptCount: { increment: 1 },
        errorCode: null,
        errorMessage: null,
      },
    });
    if (claimed.count !== 1) return;

    try {
      await this.processPublication(job.data);
    } catch (error) {
      await this.handleFailure(job, error);
    }
  }

  private async processPublication(jobData: PublicationJobData): Promise<void> {
    let publication = await this.loadPublication(jobData);
    const account = publication.instagramAccount;
    if (
      account.status !== "CONNECTED" ||
      !account.externalAccountId ||
      !account.encryptedAccessToken ||
      !account.accessTokenIv ||
      !account.accessTokenTag
    ) {
      throw new InstagramPublishingProviderError(
        "INSTAGRAM_ACCOUNT_NOT_CONNECTED",
        false,
      );
    }
    if (account.provider !== this.provider.type) {
      throw new InstagramPublishingProviderError(
        "INSTAGRAM_PROVIDER_MISMATCH",
        false,
      );
    }

    const providerAccount = {
      externalAccountId: account.externalAccountId,
      accessToken: this.encryption.decrypt({
        ciphertext: account.encryptedAccessToken,
        iv: account.accessTokenIv,
        tag: account.accessTokenTag,
      }),
    };

    if (!publication.externalContainerId) {
      let mediaUrl = publication.mediaUrl;
      if (publication.mediaAssetId) {
        const asset = publication.mediaAsset;
        if (!asset) {
          throw new InstagramPublishingProviderError(
            "MEDIA_ASSET_NOT_FOUND",
            false,
          );
        }
        mediaUrl = await this.mediaStorage.createSignedReadUrl(
          asset.storageType,
          asset.storageKey,
          asset.mimeType,
          asset.originalFileName,
        );
      }
      if (!mediaUrl) {
        throw new InstagramPublishingProviderError(
          "PUBLICATION_MEDIA_NOT_FOUND",
          false,
        );
      }
      const containerId = await this.provider.createContainer(providerAccount, {
        publicationId: publication.id,
        mediaType: publication.mediaType,
        mediaUrl,
        caption: publication.caption,
        altText: publication.altText,
        shareToFeed: publication.shareToFeed,
      });
      await this.prisma.publication.updateMany({
        where: {
          id: publication.id,
          organizationId: publication.organizationId,
          status: PublicationStatus.PROCESSING,
          externalContainerId: null,
        },
        data: { externalContainerId: containerId },
      });
      publication = await this.loadPublication(jobData);
    }

    const containerId = publication.externalContainerId;
    if (!containerId) {
      throw new InstagramPublishingProviderError(
        "INSTAGRAM_CONTAINER_ID_MISSING",
        false,
      );
    }

    if (publication.publishAttemptedAt) {
      const previousResult = await this.reconcilePreviousPublish(
        providerAccount,
        containerId,
      );
      if (previousResult === "PUBLISHED") {
        await this.markPublished(publication.id, null, jobData.organizationId);
        return;
      }
      throw new InstagramPublishingProviderError(
        "PUBLISH_OUTCOME_UNCERTAIN",
        false,
        "Instagram did not confirm the previous publish request; another request was withheld to prevent a duplicate post.",
      );
    }

    const containerStatus = await this.waitForContainerReady(
      providerAccount,
      containerId,
    );
    if (containerStatus === "PUBLISHED") {
      await this.markPublished(publication.id, null, jobData.organizationId);
      return;
    }
    if (containerStatus !== "FINISHED") {
      throw containerTerminalError(containerStatus);
    }

    await this.prisma.publication.updateMany({
      where: {
        id: publication.id,
        organizationId: publication.organizationId,
        status: PublicationStatus.PROCESSING,
        publishAttemptedAt: null,
      },
      data: { publishAttemptedAt: new Date() },
    });
    const mediaId = await this.provider.publishContainer(
      providerAccount,
      containerId,
    );
    await this.markPublished(publication.id, mediaId, jobData.organizationId);
  }

  private async waitForContainerReady(
    account: { externalAccountId: string; accessToken: string },
    containerId: string,
  ): Promise<InstagramMediaContainerStatus> {
    let status: InstagramMediaContainerStatus = "IN_PROGRESS";
    for (let attempt = 0; attempt < CONTAINER_STATUS_POLL_COUNT; attempt += 1) {
      status = await this.provider.getContainerStatus(account, containerId);
      if (status !== "IN_PROGRESS") return status;
      if (attempt + 1 < CONTAINER_STATUS_POLL_COUNT) {
        await delay(CONTAINER_STATUS_POLL_INTERVAL_MS);
      }
    }
    throw new InstagramPublishingProviderError(
      "META_CONTAINER_PROCESSING_TIMEOUT",
      true,
      "Instagram is still processing this media. A retry is scheduled.",
    );
  }

  private async reconcilePreviousPublish(
    account: { externalAccountId: string; accessToken: string },
    containerId: string,
  ): Promise<"PUBLISHED" | "UNCONFIRMED"> {
    let status: InstagramMediaContainerStatus = "IN_PROGRESS";
    for (let attempt = 0; attempt < CONTAINER_STATUS_POLL_COUNT; attempt += 1) {
      status = await this.provider.getContainerStatus(account, containerId);
      if (status === "PUBLISHED") return "PUBLISHED";
      if (status === "ERROR" || status === "EXPIRED") {
        throw containerTerminalError(status);
      }
      if (attempt + 1 < CONTAINER_STATUS_POLL_COUNT) {
        await delay(CONTAINER_STATUS_POLL_INTERVAL_MS);
      }
    }
    return "UNCONFIRMED";
  }

  private async markPublished(
    publicationId: string,
    mediaId: string | null,
    organizationId: string,
  ): Promise<void> {
    const changed = await this.prisma.publication.updateMany({
      where: {
        id: publicationId,
        status: PublicationStatus.PROCESSING,
      },
      data: {
        status: PublicationStatus.PUBLISHED,
        externalMediaId: mediaId,
        publishedAt: new Date(),
        processingStartedAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });
    if (changed.count === 1) {
      this.logger.log(`Published Instagram publication ${publicationId}`);
      await this.audit.record({
        organizationId,
        action: "PUBLICATION_PUBLISHED",
        resourceType: "publication",
        resourceId: publicationId,
        metadata: { result: "PUBLISHED" },
      });
    }
  }

  private async loadPublication(jobData: PublicationJobData) {
    return this.prisma.publication.findFirstOrThrow({
      where: {
        id: jobData.publicationId,
        organizationId: jobData.organizationId,
        status: PublicationStatus.PROCESSING,
      },
      include: { instagramAccount: true, mediaAsset: true },
    });
  }

  private async handleFailure(
    job: Job<PublicationJobData>,
    error: unknown,
  ): Promise<void> {
    const providerError =
      error instanceof InstagramPublishingProviderError ? error : null;
    const code = providerError?.code ?? "PUBLICATION_PROCESSING_FAILED";
    const safeToRepeatPublish = providerError?.safeToRepeatPublish ?? false;
    const attemptNumber = job.attemptsMade + 1;
    const willRetry =
      providerError?.retryable === true &&
      attemptNumber < PUBLICATION_MAX_ATTEMPTS;

    if (willRetry) {
      await this.prisma.publication.updateMany({
        where: {
          id: job.data.publicationId,
          organizationId: job.data.organizationId,
          status: PublicationStatus.PROCESSING,
        },
        data: {
          status: PublicationStatus.QUEUED,
          processingStartedAt: null,
          errorCode: code,
          errorMessage: "Instagram temporarily rejected or could not confirm this request. A retry is scheduled.",
          ...(safeToRepeatPublish ? { publishAttemptedAt: null } : {}),
        },
      });
      throw error;
    }

    const isUncertain = code === "PUBLISH_OUTCOME_UNCERTAIN";
    await this.prisma.publication.updateMany({
      where: {
        id: job.data.publicationId,
        organizationId: job.data.organizationId,
        status: PublicationStatus.PROCESSING,
      },
      data: {
        status: PublicationStatus.FAILED,
        processingStartedAt: null,
        errorCode: code,
        errorMessage: isUncertain
          ? "Instagram did not confirm the previous request. Check the account before creating another publication."
          : providerError?.retryable
            ? "Instagram remained unavailable after the retry limit."
            : "Instagram could not publish this content. Review the content and account connection.",
      },
    });
    await this.audit.record({
      organizationId: job.data.organizationId,
      action: "PUBLICATION_FAILED",
      resourceType: "publication",
      resourceId: job.data.publicationId,
      outcome: "FAILURE",
      metadata: { result: "FAILED" },
    });
    this.logger.warn(
      `Instagram publication ${job.data.publicationId} failed (${code})`,
    );

    if (providerError && !providerError.retryable) {
      throw new UnrecoverableError("Instagram publication failed");
    }
    if (providerError?.retryable) throw error;
    throw new UnrecoverableError("Instagram publication failed");
  }
}

function containerTerminalError(
  status: "ERROR" | "EXPIRED" | "IN_PROGRESS" | "FINISHED" | "PUBLISHED",
): InstagramPublishingProviderError {
  return new InstagramPublishingProviderError(
    `META_CONTAINER_${status}`,
    false,
    "Instagram could not prepare this media for publication.",
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

