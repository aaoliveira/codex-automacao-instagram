import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getQueueToken } from "@nestjs/bullmq";
import { NestExpressApplication } from "@nestjs/platform-express";
import { Queue } from "bullmq";
import { createHmac } from "node:crypto";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { AppModule } from "../src/app.module";
import { INSTAGRAM_WEBHOOK_QUEUE } from "../src/webhooks/webhook.constants";

describe("Instagram webhooks (e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let queue: Queue;
  const createdEventIds: string[] = [];
  const createdOrganizationIds: string[] = [];
  const createdUserEmails: string[] = [];
  const envSnapshot = {
    verifyToken: process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN,
    appSecret: process.env.META_INSTAGRAM_APP_SECRET,
    rawPayload: process.env.WEBHOOK_STORE_RAW_PAYLOAD,
  };
  const verifyToken = "e2e-instagram-webhook-verify-token";
  const appSecret = "e2e-meta-app-secret";

  beforeAll(async () => {
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = verifyToken;
    process.env.META_INSTAGRAM_APP_SECRET = appSecret;
    process.env.WEBHOOK_STORE_RAW_PAYLOAD = "false";
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      rawBody: true,
      bodyParser: false,
    });
    app.useBodyParser("json", { limit: "2mb" });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    prisma = app.get(PrismaService);
    queue = app.get<Queue>(getQueueToken(INSTAGRAM_WEBHOOK_QUEUE));
    await app.init();
  });

  afterAll(async () => {
    for (const eventId of createdEventIds) {
      const job = await queue?.getJob(eventId);
      if (job) await job.remove().catch(() => undefined);
    }
    if (createdEventIds.length > 0) {
      await prisma.webhookEvent.deleteMany({
        where: { id: { in: createdEventIds } },
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
    restoreEnv("INSTAGRAM_WEBHOOK_VERIFY_TOKEN", envSnapshot.verifyToken);
    restoreEnv("META_INSTAGRAM_APP_SECRET", envSnapshot.appSecret);
    restoreEnv("WEBHOOK_STORE_RAW_PAYLOAD", envSnapshot.rawPayload);
  });

  it("answers Meta's challenge and rejects a mismatched verify token", async () => {
    const accepted = await request(app.getHttpServer())
      .get("/api/webhooks/instagram")
      .query({
        "hub.mode": "subscribe",
        "hub.verify_token": verifyToken,
        "hub.challenge": "challenge-e2e-123",
      })
      .expect(200);

    expect(accepted.text).toBe("challenge-e2e-123");
    expect(accepted.headers["content-type"]).toContain("text/plain");

    await request(app.getHttpServer())
      .get("/api/webhooks/instagram")
      .query({
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong-e2e-token",
        "hub.challenge": "challenge-e2e-123",
      })
      .expect(403);
  });

  it("validates Meta signatures, rejects invalid ones, and processes a delivery once", async () => {
    const externalEventId = `meta-e2e-${Date.now()}`;
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "17841400000000000",
          time: 1_800_000_000,
          changes: [
            {
              field: "comments",
              event_id: externalEventId,
              value: {
                id: "comment-resource-001",
                text: "x".repeat(110_000),
              },
            },
          ],
        },
      ],
    };
    const rawBody = JSON.stringify(payload);
    const signature = sign(rawBody);

    const first = await postMeta(rawBody, signature).expect(200);
    createdEventIds.push(first.body.eventIds[0]);
    expect(first.body).toMatchObject({ accepted: 1, duplicates: 0 });

    const repeated = await postMeta(rawBody, signature).expect(200);
    expect(repeated.body).toMatchObject({
      accepted: 1,
      duplicates: 1,
      eventIds: first.body.eventIds,
    });

    const persisted = await waitForProcessed(first.body.eventIds[0]);
    expect(persisted).toMatchObject({
      provider: "META",
      externalEventId,
      eventType: "instagram.change",
      status: "PROCESSED",
      processingAttempts: 1,
      rawPayload: null,
    });
    expect(persisted.processedAt).toBeInstanceOf(Date);
    expect(
      await prisma.webhookEvent.count({
        where: { provider: "META", externalEventId },
      }),
    ).toBe(1);

    const invalid = `meta-invalid-${Date.now()}`;
    const invalidPayload = JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: "other-account",
          changes: [{ field: "comments", event_id: invalid }],
        },
      ],
    });
    await postMeta(invalidPayload, `sha256=${"0".repeat(64)}`).expect(401);
    expect(
      await prisma.webhookEvent.findFirst({
        where: { provider: "META", externalEventId: invalid },
      }),
    ).toBeNull();
  });

  it("persists, queues, and processes a MOCK event exactly once", async () => {
    const externalEventId = `mock-e2e-${Date.now()}`;
    const payload = {
      eventType: "instagram.change",
      externalEventId,
      entryId: "mock-account-001",
      field: "comments",
      data: { commentId: "mock-comment-001" },
    };

    const first = await request(app.getHttpServer())
      .post("/api/webhooks/instagram/mock")
      .send(payload)
      .expect(202);
    createdEventIds.push(first.body.eventIds[0]);
    expect(first.body).toMatchObject({ accepted: 1, duplicates: 0 });

    const duplicate = await request(app.getHttpServer())
      .post("/api/webhooks/instagram/mock")
      .send(payload)
      .expect(202);
    expect(duplicate.body).toMatchObject({
      accepted: 1,
      duplicates: 1,
      eventIds: first.body.eventIds,
    });

    const persisted = await waitForProcessed(first.body.eventIds[0]);
    expect(persisted).toMatchObject({
      provider: "MOCK",
      externalEventId,
      eventType: "instagram.change",
      status: "PROCESSED",
      processingAttempts: 1,
      rawPayload: null,
    });
    expect(persisted.processedAt).toBeInstanceOf(Date);
    expect(
      await prisma.webhookEvent.count({
        where: { provider: "MOCK", externalEventId },
      }),
    ).toBe(1);
  });

  it("lists and details only events associated with accounts in the authenticated tenant", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [owner, otherOwner] = await Promise.all([
      register(`events-owner-${suffix}@example.com`, `Events Tenant ${suffix}`),
      register(
        `events-other-${suffix}@example.com`,
        `Other Events Tenant ${suffix}`,
      ),
    ]);
    createdOrganizationIds.push(owner.body.organizationId, otherOwner.body.organizationId);
    const ownerAuth = `Bearer ${owner.body.accessToken}`;
    const otherAuth = `Bearer ${otherOwner.body.accessToken}`;

    const connection = await request(app.getHttpServer())
      .post(
        `/api/organizations/${owner.body.organizationId}/instagram/accounts/connect`,
      )
      .set("Authorization", ownerAuth)
      .expect(201);
    const accountResponse = await request(app.getHttpServer())
      .get("/api/instagram/oauth/callback")
      .query({ state: connection.body.state, code: `event-account-${suffix}` })
      .expect(200);
    const account = accountResponse.body;

    const accepted = await request(app.getHttpServer())
      .post("/api/webhooks/instagram/mock")
      .send({
        eventType: "instagram.change",
        externalEventId: `tenant-event-${suffix}`,
        entryId: account.externalAccountId,
        field: "comments",
        data: { text: "sensitive comment body excluded from read API" },
      })
      .expect(202);
    const eventId = accepted.body.eventIds[0] as string;
    createdEventIds.push(eventId);
    await waitForProcessed(eventId);

    const collectionPath = `/api/organizations/${owner.body.organizationId}/instagram/events`;
    const list = await request(app.getHttpServer())
      .get(collectionPath)
      .query({ accountId: account.id, type: "comments", status: "processed" })
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(list.body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id: eventId,
      instagramAccountId: account.id,
      accountUsername: account.username,
      eventType: "instagram.change",
      field: "comments",
      status: "PROCESSED",
    });
    expect(list.body.items[0]).not.toHaveProperty("rawPayload");
    expect(JSON.stringify(list.body)).not.toContain("sensitive comment body");

    const detail = await request(app.getHttpServer())
      .get(`${collectionPath}/${eventId}`)
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(detail.body.id).toBe(eventId);
    expect(detail.body).not.toHaveProperty("rawPayload");

    const otherCollectionPath = `/api/organizations/${otherOwner.body.organizationId}/instagram/events`;
    const isolatedList = await request(app.getHttpServer())
      .get(otherCollectionPath)
      .set("Authorization", otherAuth)
      .expect(200);
    expect(isolatedList.body.total).toBe(0);
    await request(app.getHttpServer())
      .get(`${otherCollectionPath}/${eventId}`)
      .set("Authorization", otherAuth)
      .expect(404);
    await request(app.getHttpServer())
      .get(`${collectionPath}/${eventId}`)
      .set("Authorization", otherAuth)
      .expect(404);
  });

  async function register(email: string, organizationName: string) {
    createdUserEmails.push(email);
    return request(app.getHttpServer())
      .post("/api/auth/register")
      .send({
        email,
        password: "strong-test-password-for-events-123",
        organizationName,
      })
      .expect(201);
  }

  function postMeta(rawBody: string, signature: string) {
    return request(app.getHttpServer())
      .post("/api/webhooks/instagram")
      .set("Content-Type", "application/json")
      .set("x-hub-signature-256", signature)
      .send(rawBody);
  }

  function sign(rawBody: string): string {
    const digest = createHmac("sha256", appSecret)
      .update(Buffer.from(rawBody))
      .digest("hex");
    return `sha256=${digest}`;
  }

  async function waitForProcessed(id: string) {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const event = await prisma.webhookEvent.findUnique({ where: { id } });
      if (event?.status === "PROCESSED") return event;
      if (event?.status === "FAILED") {
        throw new Error("Webhook event entered FAILED status");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Timed out waiting for webhook event processing");
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
