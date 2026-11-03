import { INestApplication, ValidationPipe } from "@nestjs/common";
import { MembershipRole } from "@prisma/client";
import { Test } from "@nestjs/testing";
import helmet from "helmet";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { isolateE2eRateLimitClient } from "./e2e-client-isolation";

describe("Automation templates (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    prisma = app.get(PrismaService);
    isolateE2eRateLimitClient(app);
    app.use(helmet());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => { await app?.close(); });

  it("creates a versioned template, applies an independent disabled rule and enforces tenant/RBAC boundaries", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [ownerResponse, otherResponse] = await Promise.all([
      request(app.getHttpServer()).post("/api/auth/register").send({ email: `template-${suffix}@example.com`, password: "strong-template-test-password-123", organizationName: `Template ${suffix}` }).expect(201),
      request(app.getHttpServer()).post("/api/auth/register").send({ email: `template-other-${suffix}@example.com`, password: "strong-template-other-password-456", organizationName: `Template Other ${suffix}` }).expect(201),
    ]);
    const ownerAuth = `Bearer ${ownerResponse.body.accessToken}`;
    const otherAuth = `Bearer ${otherResponse.body.accessToken}`;
    const base = `/api/organizations/${ownerResponse.body.organizationId}/automation-templates`;
    const otherBase = `/api/organizations/${otherResponse.body.organizationId}/automation-templates`;
    const systemList = await request(app.getHttpServer()).get(base).set("Authorization", ownerAuth).expect(200);
    expect(systemList.body.some((item: { scope: string }) => item.scope === "SYSTEM")).toBe(true);
    const system = systemList.body.find((item: { scope: string }) => item.scope === "SYSTEM");
    await request(app.getHttpServer()).patch(`${base}/${system.id}`).set("Authorization", ownerAuth).send({ name: "Modified system" }).expect(403);
    const systemCopy = await request(app.getHttpServer()).post(`${base}/${system.id}/duplicate`).set("Authorization", ownerAuth).send({ name: `Copy ${suffix}` }).expect(201);
    expect(systemCopy.body).toMatchObject({ scope: "ORGANIZATION", name: `Copy ${suffix}`, version: 1 });

    const connection = await request(app.getHttpServer()).post(`/api/organizations/${ownerResponse.body.organizationId}/instagram/accounts/connect`).set("Authorization", ownerAuth).expect(201);
    const account = await request(app.getHttpServer()).get("/api/instagram/oauth/callback").query({ state: connection.body.state, code: `template-mock-${suffix}` }).expect(200);

    const definition = {
      name: `Support ${suffix}`,
      description: "Reply to comments containing the configured word.",
      category: "CUSTOMER_SUPPORT",
      schemaVersion: 1,
      triggerType: "COMMENT_RECEIVED",
      conditions: { match: "ALL", rules: [{ field: "text", operator: "CONTAINS", value: "{{keyword}}" }] },
      actions: [{ type: "REGISTER_EVENT" }, { type: "REPLY_COMMENT", text: "Thanks, {{signature}}" }],
      variables: [
        { key: "keyword", label: "Keyword", type: "STRING", required: true, minLength: 1, maxLength: 80 },
        { key: "signature", label: "Signature", type: "STRING", required: false, defaultValue: "our team", maxLength: 80 },
      ],
    };
    const created = await request(app.getHttpServer()).post(base).set("Authorization", ownerAuth).send(definition).expect(201);
    expect(created.body.scope).toBe("ORGANIZATION");
    expect(created.body.version).toBe(1);

    const invalidValues = await request(app.getHttpServer()).post(`${base}/${created.body.id}/validate`).set("Authorization", ownerAuth).send({ variables: {} }).expect(201);
    expect(invalidValues.body.valid).toBe(false);
    const validValues = await request(app.getHttpServer()).post(`${base}/${created.body.id}/validate`).set("Authorization", ownerAuth).send({ variables: { keyword: "pricing" } }).expect(201);
    expect(validValues.body).toMatchObject({ valid: true, values: { keyword: "pricing", signature: "our team" } });

    const preview = await request(app.getHttpServer()).post(`${base}/${created.body.id}/preview`).set("Authorization", ownerAuth).send({ instagramAccountId: account.body.id, variables: { keyword: "pricing" } }).expect(201);
    expect(preview.body).toMatchObject({ active: false, conditions: { rules: [{ value: "pricing" }] }, actions: [{ type: "REGISTER_EVENT" }, { type: "REPLY_COMMENT", text: "Thanks, our team" }] });

    const rule = await request(app.getHttpServer()).post(`${base}/${created.body.id}/apply`).set("Authorization", ownerAuth).send({ instagramAccountId: account.body.id, variables: { keyword: "pricing" } }).expect(201);
    expect(rule.body).toMatchObject({ active: false, triggerType: "COMMENT_RECEIVED", conditions: { rules: [{ value: "pricing" }] } });

    const updated = await request(app.getHttpServer()).patch(`${base}/${created.body.id}`).set("Authorization", ownerAuth).send({ description: "Updated version." }).expect(200);
    expect(updated.body.version).toBe(2);
    const versions = await request(app.getHttpServer()).get(`${base}/${created.body.id}/versions`).set("Authorization", ownerAuth).expect(200);
    expect(versions.body.map((item: { version: number }) => item.version)).toEqual([2, 1]);
    const firstVersion = await request(app.getHttpServer()).get(`${base}/${created.body.id}/versions/1`).set("Authorization", ownerAuth).expect(200);
    expect(firstVersion.body.snapshot.description).toBe(definition.description);
    const originalRule = await request(app.getHttpServer()).get(`/api/organizations/${ownerResponse.body.organizationId}/automation-rules/${rule.body.id}`).set("Authorization", ownerAuth).expect(200);
    expect(originalRule.body.actions).toEqual(rule.body.actions);
    expect(originalRule.body.active).toBe(false);

    await request(app.getHttpServer()).get(`${base}/${created.body.id}`).set("Authorization", otherAuth).expect(404);
    const otherList = await request(app.getHttpServer()).get(`/api/organizations/${otherResponse.body.organizationId}/automation-templates`).set("Authorization", otherAuth).expect(200);
    expect(otherList.body.some((item: { id: string }) => item.id === created.body.id)).toBe(false);

    const exported = await request(app.getHttpServer()).get(`${base}/${created.body.id}/export`).set("Authorization", ownerAuth).expect(200);
    expect(JSON.stringify(exported.body)).not.toMatch(/organizationId|authorUserId|accessToken|password|secret/i);
    const imported = await request(app.getHttpServer()).post(`${otherBase}/import`).set("Authorization", otherAuth).send({ document: exported.body }).expect(201);
    expect(imported.body.name).toBe(created.body.name);
    await request(app.getHttpServer()).get(`${otherBase}/${imported.body.id}`).set("Authorization", otherAuth).expect(200);
    await request(app.getHttpServer()).get(`${base}/${imported.body.id}`).set("Authorization", ownerAuth).expect(404);
    await request(app.getHttpServer()).post(`${base}/import`).set("Authorization", ownerAuth).send({ document: { ...exported.body, template: { ...exported.body.template, schemaVersion: 99 } } }).expect(400);
    await request(app.getHttpServer()).post(`${base}/import`).set("Authorization", ownerAuth).send({ document: { ...exported.body, template: { ...exported.body.template, actions: [{ type: "REGISTER_EVENT", script: "process.env" }] } } }).expect(400);

    await request(app.getHttpServer()).post(`${base}/${created.body.id}/archive`).set("Authorization", ownerAuth).expect(201);
    const archivedList = await request(app.getHttpServer()).get(base).set("Authorization", ownerAuth).expect(200);
    expect(archivedList.body.some((item: { id: string }) => item.id === created.body.id)).toBe(false);
    const withArchived = await request(app.getHttpServer()).get(base).query({ includeArchived: true }).set("Authorization", ownerAuth).expect(200);
    expect(withArchived.body.some((item: { id: string }) => item.id === created.body.id)).toBe(true);
    await request(app.getHttpServer()).post(`${base}/${created.body.id}/restore`).set("Authorization", ownerAuth).expect(201);

    const audit = await request(app.getHttpServer()).get(`/api/organizations/${ownerResponse.body.organizationId}/audit-logs`).set("Authorization", ownerAuth).expect(200);
    const actions = audit.body.items.map((item: { action: string }) => item.action);
    expect(actions).toEqual(expect.arrayContaining(["AUTOMATION_TEMPLATE_CREATED", "AUTOMATION_TEMPLATE_UPDATED", "AUTOMATION_TEMPLATE_APPLIED", "AUTOMATION_TEMPLATE_ARCHIVED", "AUTOMATION_TEMPLATE_RESTORED"]));
    const otherAudit = await request(app.getHttpServer()).get(`/api/organizations/${otherResponse.body.organizationId}/audit-logs`).set("Authorization", otherAuth).expect(200);
    expect(otherAudit.body.items.map((item: { action: string }) => item.action)).toContain("AUTOMATION_TEMPLATE_IMPORTED");

    await prisma.membership.update({ where: { userId_organizationId: { userId: otherResponse.body.user.id, organizationId: otherResponse.body.organizationId } }, data: { role: MembershipRole.MEMBER } });
    await request(app.getHttpServer()).post(`/api/organizations/${otherResponse.body.organizationId}/automation-templates`).set("Authorization", otherAuth).send(definition).expect(403);
  }, 45_000);
});
