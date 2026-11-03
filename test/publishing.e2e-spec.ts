import { INestApplication, ValidationPipe } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import { Test } from "@nestjs/testing";
import { PublicationMediaType } from "@prisma/client";
import { Queue } from "bullmq";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { publicationJobId } from "../src/publishing/publishing.service";
import { INSTAGRAM_PUBLICATION_QUEUE } from "../src/publishing/publication.constants";

describe("Instagram publishing (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let queue: Queue;
  const createdPublicationIds: string[] = [];
  const createdOrganizationIds: string[] = [];
  const createdUserEmails: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    prisma = app.get(PrismaService);
    queue = app.get<Queue>(getQueueToken(INSTAGRAM_PUBLICATION_QUEUE));
    await app.init();
  });

  afterAll(async () => {
    for (const publicationId of createdPublicationIds) {
      const job = await queue?.getJob(publicationJobId(publicationId));
      if (job) await job.remove().catch(() => undefined);
    }
    if (createdPublicationIds.length > 0) {
      await prisma.publication.deleteMany({
        where: { id: { in: createdPublicationIds } },
      });
    }
    if (createdOrganizationIds.length > 0) {
      await prisma.organization.deleteMany({
        where: { id: { in: createdOrganizationIds } },
      });
    }
    if (createdUserEmails.length > 0) {
      await prisma.user.deleteMany({
        where: { email: { in: createdUserEmails } },
      });
    }
    await app?.close();
  });

  it("creates drafts, publishes MOCK photo/video/Reel, lists history, cancels, and isolates tenants", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [owner, otherOwner] = await Promise.all([
      register(`publish-owner-${suffix}@example.com`, `Publishing Tenant ${suffix}`),
      register(
        `publish-other-${suffix}@example.com`,
        `Other Publishing Tenant ${suffix}`,
      ),
    ]);
    createdOrganizationIds.push(owner.body.organizationId, otherOwner.body.organizationId);
    const ownerAuth = `Bearer ${owner.body.accessToken}`;
    const otherAuth = `Bearer ${otherOwner.body.accessToken}`;

    const connect = await request(app.getHttpServer())
      .post(
        `/api/organizations/${owner.body.organizationId}/instagram/accounts/connect`,
      )
      .set("Authorization", ownerAuth)
      .expect(201);
    const accountResponse = await request(app.getHttpServer())
      .get("/api/instagram/oauth/callback")
      .query({ state: connect.body.state, code: `publisher-${suffix}` })
      .expect(200);
    const account = accountResponse.body;
    const collectionPath = `/api/organizations/${owner.body.organizationId}/instagram/publications`;

    const mediaTypes = [
      PublicationMediaType.PHOTO,
      PublicationMediaType.VIDEO,
      PublicationMediaType.REEL,
    ];
    const drafts: Array<{
      id: string;
      body: ReturnType<typeof publicationInput>;
    }> = [];
    for (const mediaType of mediaTypes) {
      const body = publicationInput(account.id, mediaType, suffix);
      const response = await request(app.getHttpServer())
        .post(collectionPath)
        .set("Authorization", ownerAuth)
        .send(body)
        .expect(201);
      createdPublicationIds.push(response.body.id);
      expect(response.body).toMatchObject({
        mediaType,
        status: "DRAFT",
        instagramAccountId: account.id,
      });
      expect(response.body).not.toHaveProperty("mediaUrl");
      expect(JSON.stringify(response.body)).not.toMatch(/access.?token|encrypted/i);
      drafts.push({ id: response.body.id as string, body });
    }

    const duplicateDraft = await request(app.getHttpServer())
      .post(collectionPath)
      .set("Authorization", ownerAuth)
      .send(drafts[0].body)
      .expect(201);
    expect(duplicateDraft.body.id).toBe(drafts[0].id);
    await request(app.getHttpServer())
      .post(collectionPath)
      .set("Authorization", ownerAuth)
      .send({ ...drafts[0].body, caption: "Different content" })
      .expect(409);

    for (const draft of drafts) {
      await request(app.getHttpServer())
        .post(`${collectionPath}/${draft.id}/publish`)
        .set("Authorization", ownerAuth)
        .expect(202);
      await request(app.getHttpServer())
        .post(`${collectionPath}/${draft.id}/publish`)
        .set("Authorization", ownerAuth)
        .expect(202);
    }

    for (const draft of drafts) {
      const published = await waitForPublished(collectionPath, draft.id, ownerAuth);
      expect(published).toMatchObject({
        status: "PUBLISHED",
        attemptCount: 1,
      });
      expect(published.externalContainerId).toMatch(
        /^mock-container-(photo|video|reel)-/,
      );
      expect(published.externalMediaId).toMatch(
        /^mock-media-(photo|video|reel)-[a-f0-9]{20}$/,
      );
      expect(published.publishedAt).toBeTruthy();
      expect(published).not.toHaveProperty("mediaUrl");
    }

    const scheduledDraftBody = publicationInput(
      account.id,
      PublicationMediaType.PHOTO,
      `${suffix}-scheduled`,
    );
    const scheduledDraft = await request(app.getHttpServer())
      .post(collectionPath)
      .set("Authorization", ownerAuth)
      .send(scheduledDraftBody)
      .expect(201);
    createdPublicationIds.push(scheduledDraft.body.id);
    const scheduledAt = new Date(Date.now() + 5_000).toISOString();
    const scheduleBody = { scheduledAt, timezone: "UTC" };
    const scheduled = await request(app.getHttpServer())
      .post(`${collectionPath}/${scheduledDraft.body.id}/schedule`)
      .set("Authorization", ownerAuth)
      .send(scheduleBody)
      .expect(202);
    expect(scheduled.body).toMatchObject({
      id: scheduledDraft.body.id,
      status: "QUEUED",
      scheduleTimezone: "UTC",
    });
    expect(new Date(scheduled.body.scheduledAt).toISOString()).toBe(
      scheduledAt,
    );

    const repeatedSchedule = await request(app.getHttpServer())
      .post(`${collectionPath}/${scheduledDraft.body.id}/schedule`)
      .set("Authorization", ownerAuth)
      .send(scheduleBody)
      .expect(202);
    expect(repeatedSchedule.body.id).toBe(scheduled.body.id);

    const jobsPath = `/api/organizations/${owner.body.organizationId}/jobs`;
    const waitingJobs = await request(app.getHttpServer())
      .get(jobsPath)
      .query({ state: "WAITING", pageSize: 100 })
      .set("Authorization", ownerAuth)
      .expect(200);
    const scheduledJob = waitingJobs.body.items.find(
      (item: { publicationId: string }) =>
        item.publicationId === scheduledDraft.body.id,
    );
    expect(scheduledJob).toMatchObject({
      state: "WAITING",
      queueState: "delayed",
      timezone: "UTC",
    });

    const completedScheduled = await waitForPublished(
      collectionPath,
      scheduledDraft.body.id,
      ownerAuth,
    );
    expect(completedScheduled).toMatchObject({
      status: "PUBLISHED",
      attemptCount: 1,
      scheduleTimezone: "UTC",
    });
    const completedJobs = await request(app.getHttpServer())
      .get(jobsPath)
      .query({ state: "COMPLETED", pageSize: 100 })
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(
      completedJobs.body.items.some(
        (item: { publicationId: string }) =>
          item.publicationId === scheduledDraft.body.id,
      ),
    ).toBe(true);

    const firstPage = await request(app.getHttpServer())
      .get(collectionPath)
      .query({ page: 1, pageSize: 2, status: "PUBLISHED" })
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(firstPage.body).toMatchObject({
      page: 1,
      pageSize: 2,
      total: 4,
      totalPages: 2,
    });
    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.items[0]).not.toHaveProperty("mediaUrl");

    const secondPage = await request(app.getHttpServer())
      .get(collectionPath)
      .query({ page: 2, pageSize: 2 })
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(secondPage.body.items).toHaveLength(2);

    const cancelBody = publicationInput(
      account.id,
      PublicationMediaType.PHOTO,
      `${suffix}-cancel`,
    );
    const cancelDraft = await request(app.getHttpServer())
      .post(collectionPath)
      .set("Authorization", ownerAuth)
      .send(cancelBody)
      .expect(201);
    createdPublicationIds.push(cancelDraft.body.id);
    const canceled = await request(app.getHttpServer())
      .post(
        `/api/organizations/${owner.body.organizationId}/jobs/publications/${cancelDraft.body.id}/cancel`,
      )
      .set("Authorization", ownerAuth)
      .expect(202);
    expect(canceled.body.status).toBe("CANCELED");
    await request(app.getHttpServer())
      .post(`${collectionPath}/${cancelDraft.body.id}/publish`)
      .set("Authorization", ownerAuth)
      .expect(409);

    const isolatedHistory = await request(app.getHttpServer())
      .get(
        `/api/organizations/${otherOwner.body.organizationId}/instagram/publications`,
      )
      .set("Authorization", otherAuth)
      .expect(200);
    expect(isolatedHistory.body.total).toBe(0);
    await request(app.getHttpServer())
      .get(
        `/api/organizations/${otherOwner.body.organizationId}/instagram/publications/${drafts[0].id}`,
      )
      .set("Authorization", otherAuth)
      .expect(404);
    await request(app.getHttpServer())
      .get(`${collectionPath}/${drafts[0].id}`)
      .set("Authorization", otherAuth)
      .expect(404);
  });

  async function register(email: string, organizationName: string) {
    createdUserEmails.push(email);
    return request(app.getHttpServer())
      .post("/api/auth/register")
      .send({
        email,
        password: "strong-test-password-publication-123",
        organizationName,
      })
      .expect(201);
  }

  function publicationInput(
    instagramAccountId: string,
    mediaType: PublicationMediaType,
    suffix: string,
  ) {
    const isPhoto = mediaType === PublicationMediaType.PHOTO;
    return {
      instagramAccountId,
      mediaType,
      mediaUrl: `https://cdn.example.test/${suffix}/${mediaType.toLowerCase()}.${isPhoto ? "jpg" : "mp4"}`,
      caption: `Mock ${mediaType.toLowerCase()} ${suffix}`,
      ...(isPhoto ? { altText: "A test photo" } : {}),
      ...(mediaType === PublicationMediaType.REEL ? { shareToFeed: true } : {}),
      idempotencyKey: `publish-${suffix}-${mediaType.toLowerCase()}`,
    };
  }

  async function waitForPublished(
    collectionPath: string,
    publicationId: string,
    authorization: string,
  ) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const response = await request(app.getHttpServer())
        .get(`${collectionPath}/${publicationId}`)
        .set("Authorization", authorization);
      if (response.status !== 200) {
        throw new Error(`Publication status endpoint returned ${response.status}`);
      }
      if (response.body.status === "PUBLISHED") return response.body;
      if (response.body.status === "FAILED") {
        throw new Error(`MOCK publication failed: ${response.body.errorCode}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Timed out waiting for MOCK publication");
  }
});
