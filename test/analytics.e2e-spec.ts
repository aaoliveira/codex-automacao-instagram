import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  InstagramProviderType,
  MembershipRole,
  PublicationMediaType,
  PublicationStatus,
} from "@prisma/client";
import helmet from "helmet";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { isolateE2eRateLimitClient } from "./e2e-client-isolation";

describe("Publication analytics (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const organizationIds: string[] = [];
  const userEmails: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    prisma = app.get(PrismaService);
    isolateE2eRateLimitClient(app);
    app.use(helmet());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    if (organizationIds.length)
      await prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
    if (userEmails.length)
      await prisma.user.deleteMany({ where: { email: { in: userEmails } } });
    await app?.close();
  });

  it("syncs MOCK insights once, aggregates them by timezone, and enforces organization and account access", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [ownerResponse, otherResponse, memberResponse] = await Promise.all([
      register(`analytics-owner-${suffix}@example.com`, `Analytics ${suffix}`),
      register(
        `analytics-other-${suffix}@example.com`,
        `Other Analytics ${suffix}`,
      ),
      register(
        `analytics-member-${suffix}@example.com`,
        `Member Analytics ${suffix}`,
      ),
    ]);
    const owner = ownerResponse.body;
    const other = otherResponse.body;
    const member = memberResponse.body;
    organizationIds.push(
      owner.organizationId,
      other.organizationId,
      member.organizationId,
    );
    userEmails.push(owner.user.email, other.user.email, member.user.email);
    const ownerAuth = `Bearer ${owner.accessToken}`;
    const otherAuth = `Bearer ${other.accessToken}`;
    const connection = await request(app.getHttpServer())
      .post(
        `/api/organizations/${owner.organizationId}/instagram/accounts/connect`,
      )
      .set("Authorization", ownerAuth)
      .expect(201);
    const connected = await request(app.getHttpServer())
      .get("/api/instagram/oauth/callback")
      .query({ state: connection.body.state, code: `analytics-${suffix}` })
      .expect(200);
    const accountId = connected.body.id as string;
    expect(connected.body.provider).toBe(InstagramProviderType.MOCK);

    const publication = await prisma.publication.create({
      data: {
        organizationId: owner.organizationId,
        instagramAccountId: accountId,
        mediaType: PublicationMediaType.PHOTO,
        status: PublicationStatus.PUBLISHED,
        externalMediaId: `mock-media-analytics-${suffix}`,
        publishedAt: new Date("2026-06-15T12:00:00.000Z"),
        caption: "Synthetic analytics fixture",
      },
    });
    const base = `/api/organizations/${owner.organizationId}/analytics`;
    const catalog = await request(app.getHttpServer())
      .get(`${base}/metrics`)
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(
      catalog.body.find((metric: { key: string }) => metric.key === "reach"),
    ).toMatchObject({
      origin: "META",
      mockAvailable: true,
      availabilityByOrigin: {
        META: ["PHOTO", "REEL"],
        MOCK: ["PHOTO", "VIDEO", "REEL"],
      },
    });

    const syncPayload = {
      instagramAccountId: accountId,
      fromDate: "2026-06-01",
      toDate: "2026-06-30",
      timezone: "America/Sao_Paulo",
      idempotencyKey: `analytics:${suffix}`,
    };
    const started = await request(app.getHttpServer())
      .post(`${base}/sync-runs`)
      .set("Authorization", ownerAuth)
      .send(syncPayload)
      .expect(202);
    expect(started.body.status).toBe("QUEUED");
    const reused = await request(app.getHttpServer())
      .post(`${base}/sync-runs`)
      .set("Authorization", ownerAuth)
      .send(syncPayload)
      .expect(202);
    expect(reused.body).toMatchObject({ id: started.body.id, reused: true });
    await request(app.getHttpServer())
      .post(`${base}/sync-runs`)
      .set("Authorization", ownerAuth)
      .send({ ...syncPayload, fromDate: "2026-06-02" })
      .expect(409);

    const finished = await waitForRun(
      `${base}/sync-runs/${started.body.id}`,
      ownerAuth,
    );
    expect(finished).toMatchObject({
      status: "COMPLETED",
      requestedCount: 8,
      availableCount: 8,
      unavailableCount: 0,
    });
    const detail = await request(app.getHttpServer())
      .get(`${base}/publications/${publication.id}`)
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(
      detail.body.metrics.find(
        (metric: { key: string }) => metric.key === "reach",
      ).latest,
    ).toMatchObject({ status: "AVAILABLE", origin: "MOCK" });
    expect(JSON.stringify(detail.body)).not.toMatch(/token|secret|encrypted/i);

    const summary = await request(app.getHttpServer())
      .get(`${base}/summary`)
      .query({
        fromDate: "2026-06-01",
        toDate: "2026-06-30",
        timezone: "America/Sao_Paulo",
      })
      .set("Authorization", ownerAuth)
      .expect(200);
    const reach = summary.body.current.reach;
    expect(reach).toMatchObject({
      status: "AVAILABLE",
      availablePublications: 1,
      unavailablePublications: 0,
      origins: ["MOCK"],
    });
    expect(reach.value).toBeGreaterThan(0);
    const series = await request(app.getHttpServer())
      .get(`${base}/series`)
      .query({
        fromDate: "2026-06-01",
        toDate: "2026-06-30",
        timezone: "America/Sao_Paulo",
        metricKey: "reach",
      })
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(
      series.body.series[0].points.find(
        (point: { date: string }) => point.date === "2026-06-15",
      ).value,
    ).toBe(reach.value);
    const ranking = await request(app.getHttpServer())
      .get(`${base}/ranking`)
      .query({
        fromDate: "2026-06-01",
        toDate: "2026-06-30",
        timezone: "America/Sao_Paulo",
        metricKey: "reach",
      })
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(ranking.body.items).toHaveLength(1);
    expect(ranking.body.items[0]).toMatchObject({
      publicationId: publication.id,
      origin: "MOCK",
      value: reach.value,
    });

    const otherBase = `/api/organizations/${other.organizationId}/analytics`;
    const otherSummary = await request(app.getHttpServer())
      .get(`${otherBase}/summary`)
      .query({ fromDate: "2026-06-01", toDate: "2026-06-30", timezone: "UTC" })
      .set("Authorization", otherAuth)
      .expect(200);
    expect(otherSummary.body.current.reach).toMatchObject({
      value: null,
      status: "NO_DATA",
    });
    await request(app.getHttpServer())
      .get(`${otherBase}/publications/${publication.id}`)
      .set("Authorization", otherAuth)
      .expect(404);
    await request(app.getHttpServer())
      .get(`${otherBase}/sync-runs/${started.body.id}`)
      .set("Authorization", otherAuth)
      .expect(404);
    await request(app.getHttpServer())
      .post(`${otherBase}/sync-runs`)
      .set("Authorization", otherAuth)
      .send({ ...syncPayload, idempotencyKey: `foreign:${suffix}` })
      .expect(404);

    const memberId = member.user.id as string;
    const membership = await prisma.membership.create({
      data: {
        userId: memberId,
        organizationId: owner.organizationId,
        role: MembershipRole.MEMBER,
      },
    });
    await prisma.instagramAccountAccess.create({
      data: {
        organizationId: owner.organizationId,
        instagramAccountId: accountId,
        membershipId: membership.id,
        level: "VIEW",
      },
    });
    const memberLogin = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({
        email: member.user.email,
        password: "strong-analytics-member-password-123",
        organizationId: owner.organizationId,
      })
      .expect(200);
    const memberAuth = `Bearer ${memberLogin.body.accessToken}`;
    await request(app.getHttpServer())
      .get(`${base}/publications/${publication.id}`)
      .set("Authorization", memberAuth)
      .expect(200);
    await request(app.getHttpServer())
      .post(`${base}/sync-runs`)
      .set("Authorization", memberAuth)
      .send({ ...syncPayload, idempotencyKey: `member:${suffix}` })
      .expect(403);

    const audit = await request(app.getHttpServer())
      .get(`/api/organizations/${owner.organizationId}/audit-logs`)
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(
      audit.body.items.map((item: { action: string }) => item.action),
    ).toEqual(
      expect.arrayContaining([
        "analytics.insights.sync_started",
        "analytics.insights.sync_completed",
      ]),
    );
  }, 45_000);

  async function register(email: string, organizationName: string) {
    userEmails.push(email);
    return request(app.getHttpServer())
      .post("/api/auth/register")
      .send({
        email,
        password: "strong-analytics-member-password-123",
        organizationName,
      })
      .expect(201);
  }

  async function waitForRun(url: string, auth: string) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await request(app.getHttpServer())
        .get(url)
        .set("Authorization", auth)
        .expect(200);
      if (["COMPLETED", "PARTIAL", "FAILED"].includes(response.body.status))
        return response.body;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Analytics run did not finish within the test timeout");
  }
});
