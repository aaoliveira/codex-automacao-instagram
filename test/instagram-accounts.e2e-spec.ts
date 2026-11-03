import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import helmet from "helmet";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { isolateE2eRateLimitClient } from "./e2e-client-isolation";

describe("Instagram account connections and tenant isolation (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
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
    await app?.close();
  });

  it("connects in MOCK, lists, validates/syncs, disconnects, and blocks other tenants", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post("/api/auth/register")
        .send({
          email: `ig-owner-${suffix}@example.com`,
          password: "strong-test-password-first-123",
          organizationName: `Instagram Tenant A ${suffix}`,
        })
        .expect(201),
      request(app.getHttpServer())
        .post("/api/auth/register")
        .send({
          email: `ig-other-${suffix}@example.com`,
          password: "strong-test-password-second-456",
          organizationName: `Instagram Tenant B ${suffix}`,
        })
        .expect(201),
    ]);
    const firstAuth = `Bearer ${first.body.accessToken}`;
    const secondAuth = `Bearer ${second.body.accessToken}`;

    const started = await request(app.getHttpServer())
      .post(
        `/api/organizations/${first.body.organizationId}/instagram/accounts/connect`,
      )
      .set("Authorization", firstAuth)
      .expect(201);
    expect(started.body.mode).toBe("MOCK");
    expect(started.body.account.status).toBe("CONNECTING");
    expect(started.body.authorizationUrl).toContain("mock.instagram.local");

    const connected = await request(app.getHttpServer())
      .get("/api/instagram/oauth/callback")
      .query({ state: started.body.state, code: `mock-creator-${suffix}` })
      .expect(200);
    const account = connected.body;
    expect(account.status).toBe("CONNECTED");
    expect(account.username).toMatch(/^mock_[a-f0-9]{8}$/);
    expect(JSON.stringify(account)).not.toMatch(/access.?token|encrypted/i);

    await request(app.getHttpServer())
      .get(`/api/organizations/${first.body.organizationId}/instagram/accounts`)
      .set("Authorization", firstAuth)
      .expect(200)
      .expect((response) => {
        expect(response.body).toHaveLength(1);
        expect(response.body[0].id).toBe(account.id);
      });

    await request(app.getHttpServer())
      .get(
        `/api/organizations/${second.body.organizationId}/instagram/accounts/${account.id}`,
      )
      .set("Authorization", secondAuth)
      .expect(404);
    await request(app.getHttpServer())
      .get(
        `/api/organizations/${first.body.organizationId}/instagram/accounts/${account.id}`,
      )
      .set("Authorization", secondAuth)
      .expect(404);

    const synced = await request(app.getHttpServer())
      .post(
        `/api/organizations/${first.body.organizationId}/instagram/accounts/${account.id}/sync`,
      )
      .set("Authorization", firstAuth)
      .expect(201);
    expect(synced.body.status).toBe("CONNECTED");
    expect(synced.body.lastSyncedAt).toBeTruthy();

    const disconnected = await request(app.getHttpServer())
      .delete(
        `/api/organizations/${first.body.organizationId}/instagram/accounts/${account.id}`,
      )
      .set("Authorization", firstAuth)
      .expect(200);
    expect(disconnected.body.status).toBe("DISCONNECTED");

    await request(app.getHttpServer())
      .post(
        `/api/organizations/${first.body.organizationId}/instagram/accounts/${account.id}/sync`,
      )
      .set("Authorization", firstAuth)
      .expect(409);

    await request(app.getHttpServer())
      .get("/api/instagram/oauth/callback")
      .query({ state: started.body.state, code: `replay-${suffix}` })
      .expect(400);

    const reconnect = await request(app.getHttpServer())
      .post(
        `/api/organizations/${first.body.organizationId}/instagram/accounts/connect`,
      )
      .set("Authorization", firstAuth)
      .expect(201);
    const reconnected = await request(app.getHttpServer())
      .get("/api/instagram/oauth/callback")
      .query({ state: reconnect.body.state, code: `mock-creator-${suffix}` })
      .expect(200);
    expect(reconnected.body.status).toBe("CONNECTED");
    expect(reconnected.body.id).toBe(account.id);
    await request(app.getHttpServer())
      .get(`/api/organizations/${first.body.organizationId}/instagram/accounts`)
      .set("Authorization", firstAuth)
      .expect(200)
      .expect((response) => expect(response.body).toHaveLength(1));
  });

  it("filters and paginates accounts and summarizes only the active tenant", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [owner, other] = await Promise.all([
      request(app.getHttpServer())
        .post("/api/auth/register")
        .send({
          email: `account-query-${suffix}@example.com`,
          password: "strong-account-query-password-123",
          organizationName: `Account Query ${suffix}`,
        })
        .expect(201),
      request(app.getHttpServer())
        .post("/api/auth/register")
        .send({
          email: `account-query-other-${suffix}@example.com`,
          password: "strong-other-account-query-password-456",
          organizationName: `Other Account Query ${suffix}`,
        })
        .expect(201),
    ]);
    const ownerAuth = `Bearer ${owner.body.accessToken}`;
    const otherAuth = `Bearer ${other.body.accessToken}`;
    const base = `/api/organizations/${owner.body.organizationId}/instagram/accounts`;

    async function connect(code: string) {
      const started = await request(app.getHttpServer())
        .post(`${base}/connect`)
        .set("Authorization", ownerAuth)
        .expect(201);
      return request(app.getHttpServer())
        .get("/api/instagram/oauth/callback")
        .query({ state: started.body.state, code })
        .expect(200);
    }

    const [first, second] = await Promise.all([
      connect(`account-query-first-${suffix}`),
      connect(`account-query-second-${suffix}`),
    ]);

    const page = await request(app.getHttpServer())
      .get(base)
      .query({ page: 1, pageSize: 1, provider: "MOCK", status: "CONNECTED" })
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(page.body).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
      totalPages: 2,
    });
    expect(page.body.items).toHaveLength(1);
    expect(page.body.items[0]).toMatchObject({
      provider: "MOCK",
      dataMode: "MOCK",
      status: "CONNECTED",
    });

    const searched = await request(app.getHttpServer())
      .get(base)
      .query({ search: first.body.username })
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(searched.body.total).toBe(1);
    expect(searched.body.items[0].id).toBe(first.body.id);

    const summary = await request(app.getHttpServer())
      .get(`${base}/summary`)
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(summary.body).toMatchObject({
      total: 2,
      byStatus: {
        DISCONNECTED: 0,
        CONNECTING: 0,
        CONNECTED: 2,
        ERROR: 0,
      },
      byProvider: { MOCK: 2, META: 0 },
    });
    expect(summary.body.limits).toEqual({
      maxActiveAccounts: 10,
      maxGroups: 20,
    });

    await request(app.getHttpServer())
      .get(`${base}/summary`)
      .set("Authorization", otherAuth)
      .expect(404);
    await request(app.getHttpServer())
      .get(base)
      .query({ status: "UNKNOWN" })
      .set("Authorization", ownerAuth)
      .expect(400);

    expect(second.body.provider).toBe("MOCK");
  }, 45_000);
});
