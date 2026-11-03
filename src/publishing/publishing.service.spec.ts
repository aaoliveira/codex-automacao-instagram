import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { InstagramPublishingProvider } from "./instagram-publishing-provider";
import { PublishingService } from "./publishing.service";

const publicationId = "00000000-0000-4000-8000-000000000001";
const organizationId = "00000000-0000-4000-8000-000000000002";
const accountId = "00000000-0000-4000-8000-000000000003";

describe("PublishingService queue operations", () => {
  afterEach(() => jest.useRealTimers());

  it("persists and enqueues a future publication with a stable idempotency key", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-03T12:00:00.000Z"));
    const draft = makePublication("DRAFT");
    const queued = makePublication("QUEUED", {
      scheduledAt: new Date("2026-11-03T12:01:00.000Z"),
      scheduleTimezone: "America/Bahia",
    });
    const { service, prisma, queue } = createService();
    prisma.publication.findFirst
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(queued);
    prisma.publication.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.schedule(organizationId, publicationId, {
      scheduledAt: "2026-11-03T09:01:00-03:00",
      timezone: "America/Bahia",
    });

    expect(result).toMatchObject({ status: "QUEUED", scheduleTimezone: "America/Bahia" });
    expect(queue.add).toHaveBeenCalledWith(
      "publish-publication",
      { publicationId, organizationId },
      expect.objectContaining({
        jobId: `instagram-publication-${publicationId}`,
        delay: 60_000,
        attempts: 3,
        backoff: { type: "exponential", delay: 2_000 },
      }),
    );
  });

  it("manually retries only retained failed BullMQ jobs and resets retry counters", async () => {
    const failed = makePublication("FAILED");
    const queued = makePublication("QUEUED");
    const job = {
      getState: jest.fn().mockResolvedValue("failed"),
      retry: jest.fn().mockResolvedValue(undefined),
    };
    const { service, prisma, queue } = createService();
    prisma.publication.findFirst
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(queued);
    prisma.publication.updateMany.mockResolvedValue({ count: 1 });
    queue.getJob.mockResolvedValue(job);

    const result = await service.retryFailed(organizationId, publicationId);

    expect(result.status).toBe("QUEUED");
    expect(job.retry).toHaveBeenCalledWith("failed", {
      resetAttemptsMade: true,
      resetAttemptsStarted: true,
    });
  });
});

function createService() {
  const prisma = {
    publication: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const queue = {
    add: jest.fn().mockResolvedValue(undefined),
    getJob: jest.fn(),
  };
  const provider = { type: "MOCK" } as unknown as InstagramPublishingProvider;
  return {
    service: new PublishingService(
      prisma as unknown as PrismaService,
      queue as unknown as Queue,
      provider,
    ),
    prisma,
    queue,
  };
}

function makePublication(
  status: string,
  schedule: { scheduledAt?: Date | null; scheduleTimezone?: string | null } = {},
) {
  return {
    id: publicationId,
    organizationId,
    instagramAccountId: accountId,
    idempotencyKey: null,
    mediaType: "PHOTO",
    mediaUrl: "https://cdn.example.test/photo.jpg",
    caption: "Schedule test",
    altText: "Photo",
    shareToFeed: null,
    status,
    externalContainerId: null,
    externalMediaId: null,
    errorCode: null,
    errorMessage: null,
    attemptCount: 0,
    queuedAt: null,
    scheduledAt: schedule.scheduledAt ?? null,
    scheduleTimezone: schedule.scheduleTimezone ?? null,
    processingStartedAt: null,
    publishAttemptedAt: null,
    publishedAt: null,
    canceledAt: null,
    createdAt: new Date("2026-11-03T11:00:00.000Z"),
    updatedAt: new Date("2026-11-03T11:00:00.000Z"),
    instagramAccount: {
      id: accountId,
      provider: "MOCK",
      status: "CONNECTED",
      username: "mock_account",
      name: "Mock account",
    },
  };
}
