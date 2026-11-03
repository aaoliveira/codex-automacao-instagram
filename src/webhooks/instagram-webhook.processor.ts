import { Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { WebhookEventStatus } from "@prisma/client";
import { Job } from "bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import {
  InstagramChangeWebhookHandler,
  InstagramMessagingWebhookHandler,
  InstagramUnknownWebhookHandler,
} from "./instagram-webhook-event-handlers";
import { INSTAGRAM_WEBHOOK_QUEUE } from "./webhook.constants";
import {
  INSTAGRAM_AUTOMATION_JOB,
  INSTAGRAM_AUTOMATION_QUEUE,
} from "../automations/automation.constants";
import { WEBHOOK_WORKER_CONCURRENCY } from "../shared/queue-runtime-config";

const PROCESSING_LEASE_MS = 25_000;
const WORKER_LOCK_DURATION_MS = 30_000;

interface WebhookJobData {
  eventId: string;
}

@Processor(INSTAGRAM_WEBHOOK_QUEUE, {
  concurrency: WEBHOOK_WORKER_CONCURRENCY,
  lockDuration: WORKER_LOCK_DURATION_MS,
})
export class InstagramWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(InstagramWebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeHandler: InstagramChangeWebhookHandler,
    private readonly messagingHandler: InstagramMessagingWebhookHandler,
    private readonly unknownHandler: InstagramUnknownWebhookHandler,
    @InjectQueue(INSTAGRAM_AUTOMATION_QUEUE)
    private readonly automationQueue: Queue<{ eventId: string }>,
  ) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
    const claimed = await this.prisma.webhookEvent.updateMany({
      where: {
        id: job.data.eventId,
        OR: [
          {
            status: {
              in: [
                WebhookEventStatus.RECEIVED,
                WebhookEventStatus.QUEUED,
                WebhookEventStatus.FAILED,
              ],
            },
          },
          {
            status: WebhookEventStatus.PROCESSING,
            OR: [
              { processingStartedAt: { lt: staleBefore } },
              { processingStartedAt: null },
            ],
          },
        ],
      },
      data: {
        status: WebhookEventStatus.PROCESSING,
        processingAttempts: { increment: 1 },
        processingStartedAt: now,
        error: null,
      },
    });
    if (claimed.count !== 1) return;

    let processingAttempt: number | null = null;
    try {
      const event = await this.prisma.webhookEvent.findUniqueOrThrow({
        where: { id: job.data.eventId },
      });
      processingAttempt = event.processingAttempts;
      const handler = [this.changeHandler, this.messagingHandler].find(
        (candidate) => candidate.supports(event.eventType),
      );
      await (handler ?? this.unknownHandler).handle(event);
      await this.automationQueue.add(
        INSTAGRAM_AUTOMATION_JOB,
        { eventId: event.id },
        {
          jobId: event.id,
          attempts: 3,
          backoff: { type: "exponential", delay: 1_000 },
          removeOnComplete: { count: 2_000 },
          removeOnFail: { count: 2_000 },
        },
      );
      const completed = await this.prisma.webhookEvent.updateMany({
        where: {
          id: event.id,
          status: WebhookEventStatus.PROCESSING,
          processingAttempts: processingAttempt,
        },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date(),
          processingStartedAt: null,
          error: null,
        },
      });
      if (completed.count !== 1) return;
      this.logger.log(
        `Processed webhook event ${event.id} (${event.eventType})`,
      );
    } catch {
      if (processingAttempt !== null) {
        await this.prisma.webhookEvent.updateMany({
          where: {
            id: job.data.eventId,
            status: WebhookEventStatus.PROCESSING,
            processingAttempts: processingAttempt,
          },
          data: {
            status: WebhookEventStatus.FAILED,
            processingStartedAt: null,
            error: "Webhook event processing failed",
          },
        });
      }
      throw new Error("Instagram webhook event processing failed");
    }
  }
}
