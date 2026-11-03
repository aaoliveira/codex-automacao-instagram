import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import helmet from "helmet";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { isolateE2eRateLimitClient } from "./e2e-client-isolation";

describe("Advanced Instagram account management (e2e)", () => {
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

  afterAll(async () => app?.close());

  it("scopes account access, groups, filters, preferences, partial batches and audit by tenant", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const owner = await register(
      `multi-owner-${suffix}@example.com`,
      `Multi Account ${suffix}`,
    );
    const member = await register(
      `multi-member-${suffix}@example.com`,
      `Member Workspace ${suffix}`,
    );
    const ownerAuth = `Bearer ${owner.accessToken}`;
    const orgBase = `/api/organizations/${owner.organizationId}`;
    const accountsBase = `${orgBase}/instagram/accounts`;

    const membership = await request(app.getHttpServer())
      .post(`${orgBase}/members`)
      .set("Authorization", ownerAuth)
      .send({ email: member.email })
      .expect(201);
    const memberLogin = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({
        email: member.email,
        password: member.password,
        organizationId: owner.organizationId,
      })
      .expect(200);
    const memberAuth = `Bearer ${memberLogin.body.accessToken}`;

    const first = await connect(ownerAuth, accountsBase, `first-${suffix}`);
    const second = await connect(ownerAuth, accountsBase, `second-${suffix}`);
    const firstGroup = await request(app.getHttpServer())
      .post(`${accountsBase}/groups`)
      .set("Authorization", ownerAuth)
      .send({ name: "Campaigns", description: "Campaign accounts" })
      .expect(201);
    const secondGroup = await request(app.getHttpServer())
      .post(`${accountsBase}/groups`)
      .set("Authorization", ownerAuth)
      .send({ name: "Support" })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`${accountsBase}/groups/${secondGroup.body.id}`)
      .set("Authorization", ownerAuth)
      .send({
        name: "Customer Support",
        description: "Support accounts",
        sortOrder: 5,
      })
      .expect(200);

    const temporaryGroup = await request(app.getHttpServer())
      .post(`${accountsBase}/groups`)
      .set("Authorization", ownerAuth)
      .send({ name: "Temporary" })
      .expect(201);
    await request(app.getHttpServer())
      .put(`${accountsBase}/${second.id}/group`)
      .set("Authorization", ownerAuth)
      .send({ groupId: temporaryGroup.body.id })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`${accountsBase}/groups/${temporaryGroup.body.id}`)
      .set("Authorization", ownerAuth)
      .expect(200);
    const ungrouped = await request(app.getHttpServer())
      .get(`${accountsBase}/${second.id}`)
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(ungrouped.body.groupId).toBeNull();

    await request(app.getHttpServer())
      .put(`${accountsBase}/${first.id}/group`)
      .set("Authorization", ownerAuth)
      .send({ groupId: firstGroup.body.id })
      .expect(200);
    await request(app.getHttpServer())
      .put(`${accountsBase}/${second.id}/group`)
      .set("Authorization", ownerAuth)
      .send({ groupId: secondGroup.body.id })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${accountsBase}/${first.id}/metadata`)
      .set("Authorization", ownerAuth)
      .send({ internalAlias: "Spring campaign", tags: ["launch", "paid"] })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${accountsBase}/${second.id}/metadata`)
      .set("Authorization", ownerAuth)
      .send({ internalAlias: "Support inbox", tags: ["support"] })
      .expect(200);
    await request(app.getHttpServer())
      .put(`${accountsBase}/groups/order`)
      .set("Authorization", ownerAuth)
      .send({ groupIds: [secondGroup.body.id, firstGroup.body.id] })
      .expect(200);

    const filtered = await request(app.getHttpServer())
      .get(accountsBase)
      .query({
        tag: "launch",
        groupId: firstGroup.body.id,
        sortBy: "internalAlias",
        sortOrder: "asc",
        page: 1,
        pageSize: 10,
      })
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(filtered.body).toMatchObject({
      total: 1,
      items: [
        {
          id: first.id,
          internalAlias: "Spring campaign",
          tags: ["launch", "paid"],
        },
      ],
    });
    expect(JSON.stringify(filtered.body)).not.toMatch(
      /encryptedAccessToken|accessTokenIv|accessTokenTag/i,
    );
    const searched = await request(app.getHttpServer())
      .get(accountsBase)
      .query({ search: "spring campaign", page: 1 })
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(
      searched.body.items.map((account: { id: string }) => account.id),
    ).toEqual([first.id]);
    await request(app.getHttpServer())
      .put(`${accountsBase}/${second.id}/favorite`)
      .set("Authorization", ownerAuth)
      .expect(200);
    await request(app.getHttpServer())
      .put(`${accountsBase}/${second.id}/default`)
      .set("Authorization", ownerAuth)
      .expect(200);
    const favorites = await request(app.getHttpServer())
      .get(accountsBase)
      .query({ favorite: true, page: 1 })
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(
      favorites.body.items.map((account: { id: string }) => account.id),
    ).toEqual([second.id]);
    const ownerPrefs = await request(app.getHttpServer())
      .get(`${accountsBase}/preferences`)
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(ownerPrefs.body).toEqual([
      expect.objectContaining({
        accountId: second.id,
        favorite: true,
        isDefault: true,
      }),
    ]);

    const memberEmpty = await request(app.getHttpServer())
      .get(accountsBase)
      .set("Authorization", memberAuth)
      .expect(200);
    expect(memberEmpty.body).toEqual([]);
    await request(app.getHttpServer())
      .put(`${accountsBase}/${first.id}/access/${membership.body.id}`)
      .set("Authorization", ownerAuth)
      .send({ level: "VIEW" })
      .expect(200);
    const publicationsBase = `${orgBase}/instagram/publications`;
    const firstDraft = await request(app.getHttpServer())
      .post(publicationsBase)
      .set("Authorization", ownerAuth)
      .send({
        instagramAccountId: first.id,
        mediaType: "PHOTO",
        mediaUrl: "https://cdn.example.com/first.jpg",
        caption: "First account draft",
      })
      .expect(201);
    const secondDraft = await request(app.getHttpServer())
      .post(publicationsBase)
      .set("Authorization", ownerAuth)
      .send({
        instagramAccountId: second.id,
        mediaType: "PHOTO",
        mediaUrl: "https://cdn.example.com/second.jpg",
        caption: "Second account draft",
      })
      .expect(201);
    const visiblePublications = await request(app.getHttpServer())
      .get(publicationsBase)
      .set("Authorization", memberAuth)
      .expect(200);
    expect(visiblePublications.body).toMatchObject({
      total: 1,
      items: [{ id: firstDraft.body.id }],
    });
    await request(app.getHttpServer())
      .get(`${publicationsBase}/${secondDraft.body.id}`)
      .set("Authorization", memberAuth)
      .expect(404);

    const automationInput = (instagramAccountId: string, name: string) => ({
      instagramAccountId,
      name,
      active: false,
      triggerType: "COMMENT_RECEIVED",
      conditions: { match: "ALL", rules: [] },
      actions: [{ type: "REGISTER_EVENT" }],
    });
    const firstRule = await request(app.getHttpServer())
      .post(`${orgBase}/automation-rules`)
      .set("Authorization", ownerAuth)
      .send(automationInput(first.id, "Visible rule"))
      .expect(201);
    const secondRule = await request(app.getHttpServer())
      .post(`${orgBase}/automation-rules`)
      .set("Authorization", ownerAuth)
      .send(automationInput(second.id, "Hidden rule"))
      .expect(201);
    const visibleRules = await request(app.getHttpServer())
      .get(`${orgBase}/automation-rules`)
      .set("Authorization", memberAuth)
      .expect(200);
    expect(visibleRules.body.map((rule: { id: string }) => rule.id)).toEqual([
      firstRule.body.id,
    ]);
    await request(app.getHttpServer())
      .get(`${orgBase}/automation-rules/${secondRule.body.id}`)
      .set("Authorization", memberAuth)
      .expect(404);

    const visibleGroups = await request(app.getHttpServer())
      .get(`${accountsBase}/groups`)
      .set("Authorization", memberAuth)
      .expect(200);
    expect(visibleGroups.body.map((group: { id: string }) => group.id)).toEqual(
      [firstGroup.body.id],
    );
    await request(app.getHttpServer())
      .get(`${accountsBase}/${first.id}`)
      .set("Authorization", memberAuth)
      .expect(200);
    await request(app.getHttpServer())
      .get(`${accountsBase}/${second.id}`)
      .set("Authorization", memberAuth)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`${accountsBase}/${first.id}/metadata`)
      .set("Authorization", memberAuth)
      .send({ tags: ["unauthorized"] })
      .expect(403);
    await request(app.getHttpServer())
      .post(`${accountsBase}/groups`)
      .set("Authorization", memberAuth)
      .send({ name: "Nope" })
      .expect(403);

    await request(app.getHttpServer())
      .put(`${accountsBase}/${first.id}/access/${membership.body.id}`)
      .set("Authorization", ownerAuth)
      .send({ level: "MANAGE" })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${accountsBase}/${first.id}/metadata`)
      .set("Authorization", memberAuth)
      .send({ internalAlias: "Managed by member" })
      .expect(200);
    await request(app.getHttpServer())
      .post(`${accountsBase}/${first.id}/sync`)
      .set("Authorization", memberAuth)
      .expect(201);
    const memberFavorite = await request(app.getHttpServer())
      .put(`${accountsBase}/${first.id}/favorite`)
      .set("Authorization", memberAuth)
      .expect(200);
    expect(memberFavorite.body.favorite).toBe(true);
    await request(app.getHttpServer())
      .put(`${accountsBase}/${first.id}/default`)
      .set("Authorization", memberAuth)
      .expect(200);
    const memberPrefs = await request(app.getHttpServer())
      .get(`${accountsBase}/preferences`)
      .set("Authorization", memberAuth)
      .expect(200);
    expect(memberPrefs.body).toEqual([
      expect.objectContaining({
        accountId: first.id,
        favorite: true,
        isDefault: true,
      }),
    ]);
    await request(app.getHttpServer())
      .delete(`${accountsBase}/${first.id}/default`)
      .set("Authorization", memberAuth)
      .expect(200);
    const ownerPrefsAgain = await request(app.getHttpServer())
      .get(`${accountsBase}/preferences`)
      .set("Authorization", ownerAuth)
      .expect(200);
    expect(ownerPrefsAgain.body).toEqual([
      expect.objectContaining({
        accountId: second.id,
        favorite: true,
        isDefault: true,
      }),
    ]);

    const unknownId = "b1d2f5d4-63c7-4d42-9a96-7b4f0b4f7923";
    const moved = await request(app.getHttpServer())
      .post(`${accountsBase}/bulk/move-group`)
      .set("Authorization", ownerAuth)
      .send({
        accountIds: [first.id, second.id, unknownId],
        groupId: secondGroup.body.id,
      })
      .expect(201);
    expect(moved.body.items).toEqual([
      { accountId: first.id, outcome: "SUCCESS" },
      { accountId: second.id, outcome: "SUCCESS" },
      {
        accountId: unknownId,
        outcome: "FAILED",
        code: "ACCOUNT_NOT_AVAILABLE",
      },
    ]);
    const tagsBatch = await request(app.getHttpServer())
      .post(`${accountsBase}/bulk/tags`)
      .set("Authorization", ownerAuth)
      .send({ accountIds: [first.id, unknownId], tags: ["batch"] })
      .expect(201);
    expect(
      tagsBatch.body.items.map((item: { outcome: string }) => item.outcome),
    ).toEqual(["SUCCESS", "FAILED"]);
    const syncBatch = await request(app.getHttpServer())
      .post(`${accountsBase}/bulk/sync`)
      .set("Authorization", ownerAuth)
      .send({ accountIds: [first.id, unknownId] })
      .expect(201);
    expect(
      syncBatch.body.items.map((item: { outcome: string }) => item.outcome),
    ).toEqual(["SUCCESS", "FAILED"]);

    await request(app.getHttpServer())
      .delete(`${accountsBase}/${first.id}/access/${membership.body.id}`)
      .set("Authorization", ownerAuth)
      .expect(200);
    await request(app.getHttpServer())
      .get(`${accountsBase}/${first.id}`)
      .set("Authorization", memberAuth)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`${accountsBase}/groups/${firstGroup.body.id}`)
      .set("Authorization", ownerAuth)
      .expect(200);

    const audit = await request(app.getHttpServer())
      .get(`${orgBase}/audit-logs`)
      .query({ page: 1, pageSize: 100 })
      .set("Authorization", ownerAuth)
      .expect(200);
    const actions = audit.body.items.map(
      (item: { action: string }) => item.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        "instagram.account_group.created",
        "instagram.account_group.updated",
        "instagram.account_group.deleted",
        "instagram.account.access_granted",
        "instagram.accounts.bulk_move",
        "instagram.accounts.bulk_tags",
        "instagram.accounts.bulk_sync",
      ]),
    );

    await request(app.getHttpServer())
      .get(
        `/api/organizations/${member.organizationId}/instagram/accounts/${first.id}`,
      )
      .set("Authorization", ownerAuth)
      .expect(404);
  }, 60_000);

  it("enforces organization limits and prevents disconnecting accounts with active dependencies", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const owner = await register(
      `multi-limits-${suffix}@example.com`,
      `Limits ${suffix}`,
    );
    const auth = `Bearer ${owner.accessToken}`;
    const base = `/api/organizations/${owner.organizationId}/instagram/accounts`;

    await request(app.getHttpServer())
      .patch(`${base}/settings`)
      .set("Authorization", auth)
      .send({ maxActiveAccounts: 2, maxGroups: 1 })
      .expect(200);
    const group = await request(app.getHttpServer())
      .post(`${base}/groups`)
      .set("Authorization", auth)
      .send({ name: "One group" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${base}/groups`)
      .set("Authorization", auth)
      .send({ name: "Over limit" })
      .expect(409);

    const first = await connect(auth, base, `limit-first-${suffix}`);
    const second = await connect(auth, base, `limit-second-${suffix}`);
    await request(app.getHttpServer())
      .post(`${base}/connect`)
      .set("Authorization", auth)
      .expect(409);
    await request(app.getHttpServer())
      .patch(`${base}/settings`)
      .set("Authorization", auth)
      .send({ maxActiveAccounts: 1 })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`${base}/settings`)
      .set("Authorization", auth)
      .send({ maxActiveAccounts: 0 })
      .expect(400);

    const orgBase = `/api/organizations/${owner.organizationId}`;
    const rule = await request(app.getHttpServer())
      .post(`${orgBase}/automation-rules`)
      .set("Authorization", auth)
      .send({
        instagramAccountId: first.id,
        name: "Active dependency",
        triggerType: "COMMENT_RECEIVED",
        conditions: { match: "ALL", rules: [] },
        actions: [{ type: "REGISTER_EVENT" }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`${base}/${first.id}`)
      .set("Authorization", auth)
      .expect(409);
    await request(app.getHttpServer())
      .delete(`${orgBase}/automation-rules/${rule.body.id}`)
      .set("Authorization", auth)
      .expect(200);
    await request(app.getHttpServer())
      .delete(`${base}/${first.id}`)
      .set("Authorization", auth)
      .expect(200);
    await request(app.getHttpServer())
      .delete(`${base}/${second.id}`)
      .set("Authorization", auth)
      .expect(200);

    const settings = await request(app.getHttpServer())
      .get(`${base}/settings`)
      .set("Authorization", auth)
      .expect(200);
    expect(settings.body).toMatchObject({ maxActiveAccounts: 2, maxGroups: 1 });
    expect(group.body.organizationId).toBe(owner.organizationId);
  }, 60_000);

  async function register(email: string, organizationName: string) {
    const password = "advanced-account-test-password-123";
    const response = await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({ email, password, organizationName })
      .expect(201);
    return { ...response.body, email, password };
  }

  async function connect(auth: string, base: string, code: string) {
    const started = await request(app.getHttpServer())
      .post(`${base}/connect`)
      .set("Authorization", auth)
      .expect(201);
    const connected = await request(app.getHttpServer())
      .get("/api/instagram/oauth/callback")
      .query({ state: started.body.state, code })
      .expect(200);
    return connected.body as { id: string; status: string };
  }
});
