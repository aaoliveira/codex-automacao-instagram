# Instagram Automation Platform API — Backend Foundation

NestJS backend for the staged SaaS MVP. It includes users, organizations, memberships, access and refresh tokens, Instagram professional account connections (MOCK and Meta provider), webhook ingestion, asynchronous MOCK/Meta publication, a tenant-scoped automation engine, health checks, and basic role based access. The frontend is maintained separately.

## Requirements

- Node.js 20 or newer (the project was prepared for Node 24)
- npm
- Docker Engine with the Docker Compose plugin

## Local setup

```bash
cp .env.example .env
npm install
docker compose up -d
npm run prisma:generate
npm run migration
npm run seed
npm run start:dev
```

The API listens on `http://localhost:3001`. The development seed credentials come from `SEED_EMAIL` and `SEED_PASSWORD` in `.env`; change them before using the local environment. The seed is disabled when `NODE_ENV=production`.

`npm run migration` runs `prisma migrate dev` against the configured `DATABASE_URL`. To apply committed migrations in a deployment, use `npm run migration:deploy`.

## Environment

Copy `.env.example` to `.env`. `DATABASE_URL`, `REDIS_URL`, and a `JWT_ACCESS_SECRET` with at least 32 characters are required. Do not commit `.env`; it is ignored by Git. `CORS_ORIGIN` accepts a comma-separated list of allowed origins. Avoid `*` when credentials are needed.

Instagram runs in `MOCK` mode by default and needs no external credentials. Account tokens are encrypted at rest with AES-256-GCM using `INSTAGRAM_TOKEN_ENCRYPTION_KEY`. The checked-in example key is for local development only. In production, set a unique base64-encoded 32-byte key from a secret manager. Changing this key makes previously stored Instagram tokens unreadable.

For real connections, set `INSTAGRAM_PROVIDER=META`, `META_INSTAGRAM_APP_ID`, `META_INSTAGRAM_APP_SECRET`, `META_INSTAGRAM_REDIRECT_URI`, and `META_INSTAGRAM_GRAPH_API_VERSION`. Register the exact callback URL in the Instagram Login configuration in the Meta App Dashboard. Publishing requires `instagram_business_basic` and `instagram_business_content_publish`. Comment replies use the official Comment Moderation API and require `instagram_business_manage_comments`; messaging replies use the official Send API and require `instagram_business_manage_messages`. The default `META_INSTAGRAM_SCOPES` requests these permissions; set it to only permissions enabled for your app. Accounts connected before permissions were granted need to reconnect and authorize them. Instagram messaging is restricted to the same sender who initiated the conversation and the documented 24-hour response window; the engine rejects missing, expired, future-dated, or self-directed message events. Comment replies require an actual incoming comment ID. See Meta's [Business Login for Instagram](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login), [Send API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [Comment Moderation guide](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/comment-moderation), [IG User reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/), and [Content Publishing guide](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing/). Meta app review, permissions, and platform policies still apply. OAuth codes, access tokens, and provider error details are never logged or returned. Disconnect clears the locally stored token; it does not call an undocumented remote revocation endpoint.

The Meta webhook callback is `/api/webhooks/instagram`. Configure `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` to the same high-entropy value entered in the Meta App Dashboard. The GET subscription handshake echoes `hub.challenge` as plain text; POST notifications are verified against the raw request body using `X-Hub-Signature-256` and `META_INSTAGRAM_APP_SECRET`. Normalized event metadata is stored in PostgreSQL and queued in BullMQ; raw payload storage is off by default. Set `WEBHOOK_STORE_RAW_PAYLOAD=true` only if your privacy, retention, and access policies allow it; secret-like keys are redacted before storage. See Meta's [Graph API Webhooks guide](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/) and [Instagram Webhooks guide](https://developers.facebook.com/docs/instagram-platform/webhooks/).

## API

Swagger UI: `http://localhost:3001/docs`

| Method | Path                                                                    | Access                  | Purpose                                                                            |
| ------ | ----------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| GET    | `/health`                                                               | Public                  | Liveness check                                                                     |
| GET    | `/ready`                                                                | Public                  | Checks PostgreSQL and Redis                                                        |
| POST   | `/api/auth/register`                                                    | Public                  | Creates user, organization and `OWNER` membership                                  |
| POST   | `/api/auth/login`                                                       | Public                  | Signs in; accepts `organizationId` if the user has multiple memberships            |
| POST   | `/api/auth/refresh`                                                     | Public                  | Rotates a refresh token and returns a new access token                             |
| POST   | `/api/auth/logout`                                                      | Bearer token            | Revokes the supplied refresh token for the current user                            |
| GET    | `/api/auth/me`                                                          | Bearer token            | Returns user and active organization membership                                    |
| GET    | `/api/organizations/:organizationId`                                    | Bearer token            | Reads the active organization                                                      |
| GET    | `/api/organizations/:organizationId/members`                            | Owner/Admin             | Lists members                                                                      |
| POST   | `/api/organizations/:organizationId/members`                            | Owner/Admin             | Adds an already registered user as `MEMBER`                                        |
| PATCH  | `/api/organizations/:organizationId/members/:membershipId/role`         | Owner                   | Updates a membership role                                                          |
| POST   | `/api/organizations/:organizationId/instagram/accounts/connect`         | Owner/Admin             | Starts OAuth; returns authorization URL, one-time state and a `CONNECTING` account |
| GET    | `/api/instagram/oauth/callback?code=…&state=…`                          | Public, state-protected | Completes OAuth and returns the safe account projection                            |
| GET    | `/api/organizations/:organizationId/instagram/accounts`                 | Organization member     | Lists connected and pending accounts                                               |
| GET    | `/api/organizations/:organizationId/instagram/accounts/:accountId`      | Organization member     | Reads an account in the active organization                                        |
| POST   | `/api/organizations/:organizationId/instagram/accounts/:accountId/sync` | Owner/Admin             | Revalidates connection and refreshes available profile fields                      |
| DELETE | `/api/organizations/:organizationId/instagram/accounts/:accountId`      | Owner/Admin             | Disconnects and erases the stored token                                            |
| POST   | `/api/organizations/:organizationId/instagram/publications`             | Owner/Admin             | Creates an idempotent publication draft                                            |
| POST   | `/api/organizations/:organizationId/instagram/publications/:id/publish` | Owner/Admin             | Queues a draft for immediate asynchronous publication                              |
| GET    | `/api/organizations/:organizationId/instagram/publications`             | Organization member     | Lists publication history with pagination and filters                              |
| GET    | `/api/organizations/:organizationId/instagram/publications/:id`         | Organization member     | Reads publication status and safe provider identifiers                             |
| POST   | `/api/organizations/:organizationId/instagram/publications/:id/cancel`  | Owner/Admin             | Cancels a draft or queued publication before processing starts                     |
| POST   | `/api/organizations/:organizationId/automation-rules`                   | Owner/Admin             | Creates a validated tenant-scoped rule                                             |
| GET    | `/api/organizations/:organizationId/automation-rules`                   | Organization member     | Lists rules; optionally filter by Instagram account                                |
| GET    | `/api/organizations/:organizationId/automation-rules/:ruleId`           | Organization member     | Reads a rule in the active tenant                                                  |
| PATCH  | `/api/organizations/:organizationId/automation-rules/:ruleId`           | Owner/Admin             | Updates a rule                                                                     |
| DELETE | `/api/organizations/:organizationId/automation-rules/:ruleId`           | Owner/Admin             | Deactivates and soft-deletes a rule                                                |
| POST   | `/api/organizations/:organizationId/automation-rules/:ruleId/simulate`  | Owner/Admin, MOCK only  | Persists and queues a local event for a single rule                                |
| GET    | `/api/organizations/:organizationId/automation-executions`              | Organization member     | Lists paginated status and action logs                                             |
| GET    | `/api/organizations/:organizationId/automation-executions/:executionId` | Organization member     | Reads an execution and safe event metadata                                         |
| GET    | `/api/organizations/:organizationId/automation-notifications`           | Organization member     | Lists operator notifications                                                       |
| GET    | `/api/webhooks/instagram`                                               | Public                  | Validates Meta's `hub.*` subscription challenge                                    |
| POST   | `/api/webhooks/instagram`                                               | Public, HMAC validated  | Persists and queues Meta webhook events                                            |
| POST   | `/api/webhooks/instagram/mock`                                          | Public, non-production  | Generates a local event for queue and processing verification                      |

Passwords use Argon2id. Access tokens are short-lived JWTs. Refresh tokens are random opaque values; only their SHA-256 hashes are stored in PostgreSQL. Refresh rotates atomically and a previously used token cannot be used again. Membership and role are reloaded for each authenticated request, and a cross-organization resource request returns 404.

## Validation

```bash
docker compose up -d
npm run prisma:generate
npm run migration
npm run seed
npm test
npm run test:e2e
npm run build
```

The e2e suite writes uniquely named test users and organizations into the database selected by `DATABASE_URL`. Use a dedicated local/test database, not production data.

### Test MOCK publishing

With `INSTAGRAM_PROVIDER=MOCK`, connect an Instagram account as shown above and create a draft. The media URL must be a public HTTPS URL; the application passes it to Instagram and never returns that URL in publication status/history responses.

```bash
curl -X POST "http://localhost:3001/api/organizations/ORGANIZATION_ID/instagram/publications" \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"instagramAccountId":"ACCOUNT_ID","mediaType":"PHOTO","mediaUrl":"https://cdn.example.com/photo.jpg","caption":"Hello Instagram","altText":"A sample photo","idempotencyKey":"photo-demo-001"}'

curl -X POST "http://localhost:3001/api/organizations/ORGANIZATION_ID/instagram/publications/PUBLICATION_ID/publish" \
  -H "Authorization: Bearer ACCESS_TOKEN"

curl "http://localhost:3001/api/organizations/ORGANIZATION_ID/instagram/publications/PUBLICATION_ID" \
  -H "Authorization: Bearer ACCESS_TOKEN"

curl "http://localhost:3001/api/organizations/ORGANIZATION_ID/instagram/publications" \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

The MOCK provider returns deterministic container/media identifiers for photos, videos, and Reels. Draft creation is idempotent when the same organization reuses an `idempotencyKey` with identical content. Publishing the same draft repeatedly reuses its queue job and remote container. Video and Reel containers are checked until Meta reports readiness; Meta calls use the configured graph version, `graph.instagram.com`, the documented `/media`, container status, and `/media_publish` resources. Cancellation is accepted only while the publication is a draft or still queued.

### Manual tenant isolation check

Register two users; each registration creates a separate organization. Keep the first user's `accessToken` and both `organizationId` values, then call:

```bash
curl -i "http://localhost:3001/api/organizations/SECOND_ORGANIZATION_ID" \
  -H "Authorization: Bearer FIRST_USER_ACCESS_TOKEN"
```

The cross-tenant request returns `404 Organization not found`. Repeating the request with the first user's own organization ID returns `200`.

## Design notes

- `JwtAuthGuard`, `TenantGuard`, and `RolesGuard` are global. Public routes are explicit.
- Tenant checks use the organization claim from a signed access token and verify the matching membership in PostgreSQL. Route organization IDs are never trusted as tenant context.
- Organization members can be added by email after they register; this stage does not send invitations or create accounts on their behalf.
- The global validation pipe strips no unknown input silently: non-whitelisted fields are rejected.
- The global exception filter returns a stable JSON envelope and hides unexpected error details.
- Pino emits structured logs and request serializers omit headers and bodies. Authorization, cookies, passwords, and refresh token fields are redacted.
- Helmet, configurable CORS, and a global request rate limit are enabled.
- `/ready` reports `503` until both PostgreSQL and Redis respond. Instagram webhook jobs are processed asynchronously by BullMQ; event handlers currently acknowledge and classify events without business side effects.

### Automation rules

Rules use a strict JSON schema. Conditions support `ALL`/`ANY`, the fields `text`, `eventType`, `field`, `senderId`, `commentId`, `mediaId`, and `conversationId`, and the operators `EQUALS`, `CONTAINS`, `STARTS_WITH`, and `ENDS_WITH`. Comparisons are case insensitive. Conditions may be empty to match every event of the selected trigger. Each rule has at most ten actions, and no more than one outbound action (`SEND_MESSAGE` or `REPLY_COMMENT`). The engine evaluates up to 25 rules per event in a stable creation-time/ID order.

Actions are `REGISTER_EVENT`, `TAG_CONTACT`, `NOTIFY_OPERATOR`, `SEND_MESSAGE`, and `REPLY_COMMENT`. Executions and each action have persisted statuses and idempotency keys. Duplicate events do not create duplicate executions; duplicate outbound effects are blocked across rules for the same Instagram account/comment or account/message. Events from the Instagram account itself are skipped to prevent reply loops. MOCK message and comment actions are recorded locally with no external credentials.

Create a rule and simulate a keyword-triggered comment rule with `INSTAGRAM_PROVIDER=MOCK`:

```bash
curl -X POST "http://localhost:3001/api/organizations/ORGANIZATION_ID/automation-rules" \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"instagramAccountId":"ACCOUNT_ID","name":"Launch comments","triggerType":"COMMENT_RECEIVED","conditions":{"match":"ALL","rules":[{"field":"text","operator":"CONTAINS","value":"launch"}]},"actions":[{"type":"REGISTER_EVENT"},{"type":"REPLY_COMMENT","text":"Thanks for your interest!"},{"type":"TAG_CONTACT","tag":"launch-interest"},{"type":"NOTIFY_OPERATOR","message":"New launch interest"}]}'

curl -X POST "http://localhost:3001/api/organizations/ORGANIZATION_ID/automation-rules/RULE_ID/simulate" \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"eventType":"instagram.change","externalEventId":"comment-demo-001","field":"comments","data":{"text":"Tell me about the launch","commentId":"comment-demo-001","senderId":"contact-demo-001"}}'

curl "http://localhost:3001/api/organizations/ORGANIZATION_ID/automation-executions?ruleId=RULE_ID" \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

The simulation response is `202`; poll execution history until the status is `SUCCESS`, `FAILED`, or `SKIPPED`. Repeating the same simulation with the same external event ID returns the existing execution. The normal webhook ingestion pipeline also enqueues matching events automatically.
>>>>>>> e568d3a (feat: Prompt 09 — Backend Automation Engine)

### Test a MOCK connection

Authenticate as the seeded owner, then start the flow. The returned `state` is one-time, expires after ten minutes, and is stored only as a SHA-256 hash. For a local MOCK connection, simulate the provider redirect with any non-empty code:

```bash
curl -X POST "http://localhost:3001/api/organizations/ORGANIZATION_ID/instagram/accounts/connect" \
  -H "Authorization: Bearer ACCESS_TOKEN"

curl -G "http://localhost:3001/api/instagram/oauth/callback" \
  --data-urlencode "state=STATE_FROM_CONNECT" \
  --data-urlencode "code=mock-local-creator"
```

Use the returned account `id` to `GET /api/organizations/ORGANIZATION_ID/instagram/accounts`, `POST .../:accountId/sync`, and `DELETE .../:accountId`. Account responses contain no token fields.

### Test Instagram webhooks locally

With PostgreSQL and Redis running, the development-only MOCK endpoint persists and queues a synthetic event without Meta credentials:

```bash
curl -i -X POST "http://localhost:3001/api/webhooks/instagram/mock" \
  -H "Content-Type: application/json" \
  -d '{"eventType":"instagram.change","externalEventId":"mock-event-001","entryId":"mock-account-001","field":"comments","data":{"commentId":"mock-comment-001"}}'
```

Inspect `webhook_events` for `status=PROCESSED`, `processed_at`, and `processing_attempts=1`. Repeating the same request is idempotent.

For Meta's HTTPS callback during local development, expose port 3001 with either [ngrok](https://ngrok.com/docs/getting-started/) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-local-tunnel/):

```bash
ngrok http 3001
# or
cloudflared tunnel --url http://localhost:3001
```

Use the generated HTTPS hostname plus `/api/webhooks/instagram` as the callback URL, and enter the configured verify token in the Meta App Dashboard. The tunnel URL may change between local runs; update the dashboard callback when it does. Do not enable raw payload storage for real user content without confirming applicable retention and privacy requirements.
