import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { InstagramWebhooksService } from "./instagram-webhooks.service";

describe("InstagramWebhooksService", () => {
  it("persists duplicate MOCK deliveries once and reuses one queue job id", async () => {
    const event = {
      id: "webhook-event-1",
      provider: "MOCK",
      externalEventId: "mock-comment-event-1",
      dedupeKey: "dedupe-key",
      eventType: "instagram.change",
      normalizedPayload: { object: "instagram" },
      rawPayload: null,
      receivedAt: new Date(),
      processedAt: null,
      status: "RECEIVED",
      error: null,
      processingAttempts: 0,
    };
    const savedJobs = new Map<string, unknown>();
    const prisma = {
      webhookEvent: {
        create: jest
          .fn()
          .mockResolvedValueOnce(event)
          .mockRejectedValueOnce(
            new Prisma.PrismaClientKnownRequestError(
              "Unique constraint failed",
              { code: "P2002", clientVersion: "test" },
            ),
          ),
        findFirst: jest.fn().mockImplementation(async () => ({
          ...event,
          status: "QUEUED",
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as PrismaService;
    const queue = {
      add: jest.fn().mockImplementation(async (_name, data, options) => {
        if (!savedJobs.has(options.jobId)) {
          savedJobs.set(options.jobId, { data });
        }
        return savedJobs.get(options.jobId);
      }),
      getJob: jest.fn().mockResolvedValue(null),
    } as unknown as Queue<{ eventId: string }>;
    const config = {
      get: jest.fn().mockReturnValue(false),
    } as unknown as ConfigService;
    const service = new InstagramWebhooksService(prisma, config, queue);
    const mockPayload = {
      eventType: "instagram.change",
      externalEventId: "mock-comment-event-1",
      entryId: "mock-account-1",
      field: "comments",
      data: { commentId: "comment-1" },
    };

    const first = await service.receiveMockEvent(mockPayload);
    const second = await service.receiveMockEvent(mockPayload);

    expect(first).toEqual({ accepted: 1, duplicates: 0, eventIds: [event.id] });
    expect(second).toEqual({
      accepted: 1,
      duplicates: 1,
      eventIds: [event.id],
    });
    expect(savedJobs.size).toBe(1);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });
});
