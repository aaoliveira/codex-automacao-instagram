import { WebhookEventStatus } from "@prisma/client";
import { Job } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import {
  InstagramChangeWebhookHandler,
  InstagramMessagingWebhookHandler,
  InstagramUnknownWebhookHandler,
} from "./instagram-webhook-event-handlers";
import { InstagramWebhookProcessor } from "./instagram-webhook.processor";

describe("InstagramWebhookProcessor", () => {
  it("dispatches a queued event once and ignores a duplicate job", async () => {
    const eventId = "webhook-event-1";
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const prisma = {
      webhookEvent: {
        updateMany,
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: eventId,
          eventType: "instagram.change",
          provider: "MOCK",
          processingAttempts: 1,
        }),
      },
    } as unknown as PrismaService;
    const changeHandler = {
      supports: jest.fn(
        (eventType: string) => eventType === "instagram.change",
      ),
      handle: jest.fn().mockResolvedValue(undefined),
    } as unknown as InstagramChangeWebhookHandler;
    const messagingHandler = {
      supports: jest.fn(
        (eventType: string) => eventType === "instagram.messaging",
      ),
      handle: jest.fn().mockResolvedValue(undefined),
    } as unknown as InstagramMessagingWebhookHandler;
    const unknownHandler = {
      supports: jest.fn().mockReturnValue(true),
      handle: jest.fn().mockResolvedValue(undefined),
    } as unknown as InstagramUnknownWebhookHandler;
    const processor = new InstagramWebhookProcessor(
      prisma,
      changeHandler,
      messagingHandler,
      unknownHandler,
      { add: jest.fn().mockResolvedValue(undefined) } as never,
    );
    const job = { data: { eventId } } as Job<{ eventId: string }>;

    await processor.process(job);
    await processor.process(job);

    expect(updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: eventId,
          OR: expect.arrayContaining([
            expect.objectContaining({
              status: {
                in: [
                  WebhookEventStatus.RECEIVED,
                  WebhookEventStatus.QUEUED,
                  WebhookEventStatus.FAILED,
                ],
              },
            }),
          ]),
        }),
        data: expect.objectContaining({
          status: WebhookEventStatus.PROCESSING,
          processingAttempts: { increment: 1 },
          processingStartedAt: expect.any(Date),
        }),
      }),
    );
    expect(changeHandler.handle).toHaveBeenCalledTimes(1);
    expect(messagingHandler.handle).not.toHaveBeenCalled();
    expect(unknownHandler.handle).not.toHaveBeenCalled();
  });
});
