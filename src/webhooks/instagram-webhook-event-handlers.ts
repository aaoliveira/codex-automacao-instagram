import { Injectable } from "@nestjs/common";
import { WebhookEvent } from "@prisma/client";

export interface InstagramWebhookEventHandler {
  supports(eventType: string): boolean;
  handle(event: WebhookEvent): Promise<void>;
}

@Injectable()
export class InstagramChangeWebhookHandler implements InstagramWebhookEventHandler {
  supports(eventType: string): boolean {
    return eventType === "instagram.change";
  }

  async handle(_event: WebhookEvent): Promise<void> {
    // Business handling is intentionally deferred to a later stage.
    await Promise.resolve();
  }
}

@Injectable()
export class InstagramMessagingWebhookHandler implements InstagramWebhookEventHandler {
  supports(eventType: string): boolean {
    return eventType === "instagram.messaging";
  }

  async handle(_event: WebhookEvent): Promise<void> {
    // Business handling is intentionally deferred to a later stage.
    await Promise.resolve();
  }
}

@Injectable()
export class InstagramUnknownWebhookHandler implements InstagramWebhookEventHandler {
  supports(_eventType: string): boolean {
    return true;
  }

  async handle(_event: WebhookEvent): Promise<void> {
    // Unknown event types are acknowledged without business side effects.
    await Promise.resolve();
  }
}
