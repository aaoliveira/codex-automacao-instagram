import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectQueue } from "@nestjs/bullmq";
import { Prisma, WebhookEventStatus } from "@prisma/client";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { MockInstagramWebhookDto } from "./dto/mock-instagram-webhook.dto";
import {
  NormalizedWebhookEvent,
  normalizeMetaWebhook,
  normalizeMockWebhook,
} from "./instagram-webhook-normalizer";
import {
  INSTAGRAM_WEBHOOK_JOB,
  INSTAGRAM_WEBHOOK_QUEUE,
} from "./webhook.constants";

interface WebhookJobData {
  eventId: string;
}

interface AcceptedEventResult {
  id: string;
  duplicate: boolean;
}

@Injectable()
export class InstagramWebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue(INSTAGRAM_WEBHOOK_QUEUE)
    private readonly queue: Queue<WebhookJobData>,
  ) {}

  receiveMetaEvent(payload: unknown) {
    const events = normalizeMetaWebhook(
      payload,
      this.config.get<boolean>("WEBHOOK_STORE_RAW_PAYLOAD", false),
    );
    return this.persistAndEnqueue(events);
  }

  receiveMockEvent(payload: MockInstagramWebhookDto) {
    const event = normalizeMockWebhook(
      payload,
      this.config.get<boolean>("WEBHOOK_STORE_RAW_PAYLOAD", false),
    );
    return this.persistAndEnqueue([event]);
  }

  private async persistAndEnqueue(events: NormalizedWebhookEvent[]) {
    const results: AcceptedEventResult[] = [];
    for (let offset = 0; offset < events.length; offset += 25) {
      const batch = events.slice(offset, offset + 25);
      results.push(
        ...(await Promise.all(batch.map((event) => this.acceptOne(event)))),
      );
    }
    return {
      accepted: results.length,
      duplicates: results.filter((result) => result.duplicate).length,
      eventIds: results.map((result) => result.id),
    };
  }

  private async acceptOne(event: NormalizedWebhookEvent) {
    let record;
    let duplicate = false;
    try {
      record = await this.prisma.webhookEvent.create({
        data: {
          provider: event.provider,
          externalEventId: event.externalEventId,
          dedupeKey: event.dedupeKey,
          eventType: event.eventType,
          normalizedPayload: event.normalizedPayload,
          rawPayload: event.rawPayload ?? Prisma.DbNull,
        },
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      ) {
        throw error;
      }
      duplicate = true;
      record = await this.prisma.webhookEvent.findFirst({
        where: {
          provider: event.provider,
          OR: [
            { dedupeKey: event.dedupeKey },
            ...(event.externalEventId
              ? [{ externalEventId: event.externalEventId }]
              : []),
          ],
        },
      });
      if (!record) throw error;
    }

    if (record.status !== WebhookEventStatus.PROCESSED) {
      if (record.status === WebhookEventStatus.FAILED) {
        const failedJob = await this.queue.getJob(record.id);
        if (failedJob && (await failedJob.getState()) === "failed") {
          await failedJob.remove();
        }
      }
      try {
        await this.queue.add(
          INSTAGRAM_WEBHOOK_JOB,
          { eventId: record.id },
          {
            jobId: record.id,
            attempts: 5,
            backoff: { type: "exponential", delay: 1_000 },
            removeOnComplete: { count: 5_000 },
            removeOnFail: { count: 5_000 },
          },
        );
      } catch {
        throw new ServiceUnavailableException(
          "Webhook event could not be queued",
        );
      }
      await this.prisma.webhookEvent.updateMany({
        where: {
          id: record.id,
          status: {
            in: [WebhookEventStatus.RECEIVED, WebhookEventStatus.FAILED],
          },
        },
        data: { status: WebhookEventStatus.QUEUED, error: null },
      });
    }

    return { id: record.id, duplicate };
  }
}
