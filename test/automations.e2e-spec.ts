import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import helmet from "helmet";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Instagram automation engine (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
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

  it("runs a MOCK comment keyword rule once, records actions, and scopes the rule to its tenant", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [owner, other] = await Promise.all([
      request(app.getHttpServer())
        .post("/api/auth/register")
        .send({
          email: `automation-${suffix}@example.com`,
          password: "strong-automation-test-password-123",
          organizationName: `Automation ${suffix}`,
        })
        .expect(201),
      request(app.getHttpServer())
        .post("/api/auth/register")
        .send({
          email: `other-automation-${suffix}@example.com`,
          password: "strong-other-test-password-456",
          organizationName: `Other ${suffix}`,
        })
        .expect(201),
    ]);
    const auth = `Bearer ${owner.body.accessToken}`;
    const otherAuth = `Bearer ${other.body.accessToken}`;
    const base = `/api/organizations/${owner.body.organizationId}`;
    const connection = await request(app.getHttpServer())
      .post(`${base}/instagram/accounts/connect`)
      .set("Authorization", auth)
      .expect(201);
    const connected = await request(app.getHttpServer())
      .get("/api/instagram/oauth/callback")
      .query({
        state: connection.body.state,
        code: `mock-automation-${suffix}`,
      })
      .expect(200);
    const accountId = connected.body.id;

    const rule = await request(app.getHttpServer())
      .post(`${base}/automation-rules`)
      .set("Authorization", auth)
      .send({
        instagramAccountId: accountId,
        name: "Comment keyword response",
        active: true,
        triggerType: "COMMENT_RECEIVED",
        conditions: {
          match: "ALL",
          rules: [{ field: "text", operator: "CONTAINS", value: "launch" }],
        },
        actions: [
          { type: "REGISTER_EVENT" },
          { type: "REPLY_COMMENT", text: "Thanks for your interest!" },
          { type: "TAG_CONTACT", tag: "launch-interest" },
          { type: "NOTIFY_OPERATOR", message: "New launch interest" },
        ],
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(
        `/api/organizations/${other.body.organizationId}/automation-rules/${rule.body.id}`,
      )
      .set("Authorization", otherAuth)
      .expect(404);

    const event = {
      eventType: "instagram.change",
      externalEventId: `automation-event-${suffix}`,
      field: "comments",
      data: {
        text: "Tell me about the LAUNCH",
        commentId: `comment-${suffix}`,
        senderId: `contact-${suffix}`,
      },
    };
    const queued = await request(app.getHttpServer())
      .post(`${base}/automation-rules/${rule.body.id}/simulate`)
      .set("Authorization", auth)
      .send(event)
      .expect(202);
    const completed = await waitForExecution(
      app,
      base,
      auth,
      rule.body.id,
      queued.body.eventId,
      "SUCCESS",
    );
    expect(
      completed.actionExecutions.map(
        (action: { status: string }) => action.status,
      ),
    ).toEqual(["SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS"]);
    expect(completed.actionExecutions[1].result.externalId).toMatch(
      /^mock-comment_reply-/,
    );
    expect(JSON.stringify(completed)).not.toMatch(/access.?token|encrypted/i);

    const duplicate = await request(app.getHttpServer())
      .post(`${base}/automation-rules/${rule.body.id}/simulate`)
      .set("Authorization", auth)
      .send(event)
      .expect(202);
    expect(duplicate.body.duplicate).toBe(true);
    const listed = await request(app.getHttpServer())
      .get(`${base}/automation-executions`)
      .set("Authorization", auth)
      .query({ ruleId: rule.body.id })
      .expect(200);
    expect(listed.body.total).toBe(1);

    const nonmatching = await request(app.getHttpServer())
      .post(`${base}/automation-rules/${rule.body.id}/simulate`)
      .set("Authorization", auth)
      .send({
        ...event,
        externalEventId: `automation-event-nomatch-${suffix}`,
        data: {
          text: "A question about pricing",
          commentId: `comment-nomatch-${suffix}`,
          senderId: `contact-${suffix}`,
        },
      })
      .expect(202);
    await waitForExecution(
      app,
      base,
      auth,
      rule.body.id,
      nonmatching.body.eventId,
      "SKIPPED",
    );
  }, 45_000);
});

async function waitForExecution(
  app: INestApplication,
  base: string,
  auth: string,
  ruleId: string,
  eventId: string,
  expected: string,
) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await request(app.getHttpServer())
      .get(`${base}/automation-executions`)
      .set("Authorization", auth)
      .query({ ruleId, webhookEventId: eventId })
      .expect(200);
    const execution = response.body.items[0];
    if (execution?.status === expected) return execution;
    if (execution?.status === "FAILED")
      throw new Error(`Automation failed with ${execution.errorCode}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Automation execution did not reach ${expected} before timeout`,
  );
}
