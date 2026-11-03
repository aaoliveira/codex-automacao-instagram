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

To run the API in a container instead of on the host, run migrations and the seed as one-off Compose tasks, then start the app profile:

```bash
docker compose --profile migration run --rm migration
docker compose --profile migration run --rm migration npm run seed
docker compose --profile app up -d --build api
```

This starts the NestJS image on port 3001, connects it to the Compose PostgreSQL and Redis services, persists local media in the `media_data` volume, and exposes the `/health` container health check. Do not run `npm run start:dev` at the same time because both use port 3001. `Dockerfile` also has a `migration` build target for one-off `prisma migrate deploy` tasks in container platforms.

If host port 3001 is already in use, set `API_PORT=3004` in `.env`; the container still listens on port 3001 internally.

For a production image, build and push the runtime target to the platform's container registry:

```bash
docker build --target runtime -t instagram-automation-api:latest .
```

Run it with port 3001, a reachable PostgreSQL `DATABASE_URL`, a reachable Redis `REDIS_URL`, and the production secrets and Meta/S3 settings described below. Use managed PostgreSQL/Redis and S3-compatible storage in production; configure the platform's health probe to `/ready` and run the migration target as a release task before deploying the new API image.

`npm run migration` runs `prisma migrate dev` against the configured `DATABASE_URL`. To apply committed migrations in a deployment, use `npm run migration:deploy`.

## Environment

Copy `.env.example` to `.env`. `DATABASE_URL`, `REDIS_URL`, and a `JWT_ACCESS_SECRET` with at least 32 characters are required. Do not commit `.env`; it is ignored by Git. `CORS_ORIGIN` accepts a comma-separated list of allowed origins. Avoid `*` when credentials are needed.

Instagram runs in `MOCK` mode by default and needs no external credentials. Account tokens are encrypted at rest with AES-256-GCM using `INSTAGRAM_TOKEN_ENCRYPTION_KEY`. The checked-in example key is for local development only. In production, set a unique base64-encoded 32-byte key from a secret manager. Changing this key makes previously stored Instagram tokens unreadable.

Real integration is opt-in: MOCK remains the default and works without Meta credentials. To enable Instagram Login, set `INSTAGRAM_PROVIDER=META`, `META_INSTAGRAM_APP_ID`, `META_INSTAGRAM_APP_SECRET`, `META_INSTAGRAM_REDIRECT_URI`, and `META_INSTAGRAM_GRAPH_API_VERSION` to the version currently enabled for your Meta app. Register the exact callback URL in the Instagram Login configuration in the Meta App Dashboard. The configured scopes may include `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, and `instagram_business_manage_messages`; request only permissions enabled for your app. Publishing and comment moderation require their respective permissions, and connected accounts may need to reconnect after permissions change. The product sends no unsolicited or bulk messages: an automated message action can only respond to the sender of an inbound Instagram messaging event, and events without a sender or timestamp, self-originated events, future events, and events outside the engine's conservative 24-hour response guard are rejected. Meta's current eligibility and limits still apply to each account and app. Comment replies require an actual incoming comment ID. See Meta's [Instagram API Postman documentation](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [Business Login for Instagram](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login), [Comment Moderation guide](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/comment-moderation), and [Content Publishing guide](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing/). App review, permissions, account type, and platform policies still apply. OAuth codes, access tokens, and provider error details are never logged or returned. Profile calls use a bearer header instead of putting the token in the URL. Disconnect clears the locally stored token; it does not call an undocumented remote revocation endpoint.

The Meta webhook callback is `/api/webhooks/instagram`. Configure `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` to the same high-entropy value entered in the Meta App Dashboard. The GET subscription handshake echoes `hub.challenge` as plain text; POST notifications are verified against the raw request body using `X-Hub-Signature-256` and `META_INSTAGRAM_APP_SECRET`. Normalized event metadata is stored in PostgreSQL and queued in BullMQ; raw payload storage is off by default. Set `WEBHOOK_STORE_RAW_PAYLOAD=true` only if your privacy, retention, and access policies allow it; secret-like keys are redacted before storage. See Meta's [Graph API Webhooks guide](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/) and [Instagram Webhooks guide](https://developers.facebook.com/docs/instagram-platform/webhooks/).

## API

Swagger UI: `http://localhost:3001/docs`

| Method | Path                                                                    | Access                  | Purpose                                                                            |
| ------ | ----------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| GET    | `/health`                                                               | Public                  | Liveness check                                                                     |
| GET    | `/ready`                                                                | Public                  | Checks PostgreSQL and Redis                                                        |
| GET    | `/metrics`                                                              | Public                  | Process and HTTP Prometheus metrics                                                |
| POST   | `/api/auth/register`                                                    | Public                  | Creates user, organization and `OWNER` membership                                  |
| POST   | `/api/auth/login`                                                       | Public                  | Signs in; accepts `organizationId` if the user has multiple memberships            |
| POST   | `/api/auth/refresh`                                                     | Public                  | Rotates a refresh token and returns a new access token                             |
| POST   | `/api/auth/logout`                                                      | Bearer token            | Revokes the supplied refresh token for the current user                            |
| GET    | `/api/auth/me`                                                          | Bearer token            | Returns user and active organization membership                                    |
| GET    | `/api/organizations/:organizationId`                                    | Bearer token            | Reads the active organization                                                      |
| GET    | `/api/organizations/:organizationId/members`                            | Owner/Admin             | Lists members                                                                      |
| POST   | `/api/organizations/:organizationId/members`                            | Owner/Admin             | Adds an already registered user as `MEMBER`                                        |
| PATCH  | `/api/organizations/:organizationId/members/:membershipId/role`         | Owner                   | Updates a membership role                                                          |
| GET    | `/api/organizations/:organizationId/audit-logs`                         | Owner/Admin             | Lists tenant audit entries with pagination and filters                            |
| POST   | `/api/organizations/:organizationId/instagram/accounts/connect`         | Owner/Admin             | Starts OAuth; returns authorization URL, one-time state and a `CONNECTING` account |
| GET    | `/api/instagram/oauth/callback?code=…&state=…`                          | Public, state-protected | Completes OAuth and returns the safe account projection                            |
| GET    | `/api/organizations/:organizationId/instagram/accounts`                 | Owner/Admin; MEMBER with account grant | Lists accessible accounts; unfiltered legacy response stays an array              |
| GET    | `/api/organizations/:organizationId/instagram/accounts?status=CONNECTED&provider=MOCK&groupId=UUID&tag=brand&favorite=true&search=brand&page=1&pageSize=20&sortBy=username&sortOrder=asc` | Owner/Admin; granted MEMBER | Filters and paginates, returning `{ items, page, pageSize, total, totalPages }` |
| GET    | `/api/organizations/:organizationId/instagram/accounts/summary`         | Owner/Admin; granted MEMBER | Accessible account counts by status/provider, visible group counts and configured limits |
| GET    | `/api/organizations/:organizationId/instagram/accounts/:accountId`      | Owner/Admin; VIEW/MANAGE  | Reads an accessible account in the active organization                             |
| POST   | `/api/organizations/:organizationId/instagram/accounts/:accountId/sync` | Owner/Admin; MANAGE       | Revalidates connection and refreshes available profile fields                      |
| DELETE | `/api/organizations/:organizationId/instagram/accounts/:accountId`      | Owner/Admin               | Disconnects only when active automations and pending publications are resolved     |
| POST   | `/api/organizations/:organizationId/instagram/publications`             | Owner/Admin             | Creates an idempotent publication draft                                            |
| POST   | `/api/organizations/:organizationId/instagram/publications/:id/publish` | Owner/Admin             | Queues a draft for immediate asynchronous publication                              |
| POST   | `/api/organizations/:organizationId/instagram/publications/:id/schedule` | Owner/Admin            | Schedules a draft using an RFC 3339 instant and IANA timezone                       |
| GET    | `/api/organizations/:organizationId/instagram/publications`             | Owner/Admin; MEMBER with account grant | Lists only history for accessible accounts, with pagination and filters |
| GET    | `/api/organizations/:organizationId/instagram/publications/:id`         | Owner/Admin; MEMBER with account grant | Reads an accessible publication status and safe provider identifiers |
| POST   | `/api/organizations/:organizationId/instagram/publications/:id/cancel`  | Owner/Admin             | Cancels a draft or queued publication before processing starts                     |
| GET    | `/api/organizations/:organizationId/jobs`                               | Owner/Admin             | Lists paginated publication jobs by `WAITING`, `PROCESSING`, `COMPLETED`, `FAILED`, or `CANCELED` |
| GET    | `/api/organizations/:organizationId/jobs/metrics`                       | Owner/Admin             | Reads tenant-scoped counts for each publication job state                          |
| POST   | `/api/organizations/:organizationId/jobs/publications/:id/retry`        | Owner/Admin             | Manually retries a retained failed publication job                                |
| POST   | `/api/organizations/:organizationId/jobs/publications/:id/cancel`       | Owner/Admin             | Cancels a publication that has not started                                         |
| POST   | `/api/organizations/:organizationId/automation-rules`                   | Owner/Admin             | Creates a validated tenant-scoped rule                                             |
| GET    | `/api/organizations/:organizationId/automation-rules`                   | Owner/Admin; MEMBER with account grant | Lists rules only for accessible accounts; optionally filters by account |
| GET    | `/api/organizations/:organizationId/automation-rules/:ruleId`           | Owner/Admin; MEMBER with account grant | Reads a rule only when its account is accessible |
| PATCH  | `/api/organizations/:organizationId/automation-rules/:ruleId`           | Owner/Admin             | Updates a rule                                                                     |
| DELETE | `/api/organizations/:organizationId/automation-rules/:ruleId`           | Owner/Admin             | Deactivates and soft-deletes a rule                                                |
| POST   | `/api/organizations/:organizationId/automation-rules/:ruleId/simulate`  | Owner/Admin, MOCK only  | Persists and queues a local event for a single rule                                |
| GET    | `/api/organizations/:organizationId/automation-executions`              | Owner/Admin; MEMBER with account grant | Lists status and action logs only for accessible accounts |
| GET    | `/api/organizations/:organizationId/automation-executions/:executionId` | Owner/Admin; MEMBER with account grant | Reads an execution only when its account is accessible |
| GET    | `/api/organizations/:organizationId/automation-notifications`           | Owner/Admin; MEMBER with account grant | Lists notifications only for accessible accounts |
| GET    | `/api/webhooks/instagram`                                               | Public                  | Validates Meta's `hub.*` subscription challenge                                    |
| POST   | `/api/webhooks/instagram`                                               | Public, HMAC validated  | Persists and queues Meta webhook events                                            |
| POST   | `/api/webhooks/instagram/mock`                                          | Public, non-production  | Generates a local event for queue and processing verification                      |

Passwords use Argon2id. Access tokens are short-lived JWTs. Refresh tokens are random opaque values; only their SHA-256 hashes are stored in PostgreSQL. Refresh rotates atomically and a previously used token cannot be used again. Membership and role are reloaded for each authenticated request, and a cross-organization resource request returns 404.

Account list filters accept `status` (`DISCONNECTED`, `CONNECTING`, `CONNECTED`, `ERROR`), `provider` (`MOCK`, `META`), `groupId`, `tag`, `favorite`, and case-insensitive `search` against username, display name, external account ID, and internal alias. Pagination accepts `page` (1–1,000,000) and `pageSize` (1–100); stable sorting accepts `sortBy=createdAt|username|name|lastSyncedAt|internalAlias` and `sortOrder=asc|desc`. For compatibility, the account list without query parameters keeps its existing array response. Account projections include `provider` and `dataMode`, so MOCK-backed data is explicitly labeled. Account summaries and visible group counts are always scoped to the authenticated organization and, for MEMBERs, to their explicit account grants.

### Advanced multi-account management

All routes below are under `/api/organizations/:organizationId/instagram/accounts`. The organization ID in the route is checked against the authenticated membership. Account and group IDs are resolved together with that organization in database queries and composite foreign keys.

| Method | Path | Access | Behavior |
| --- | --- | --- | --- |
| GET/POST | `/groups` | GET: organization members; POST: OWNER/ADMIN | List groups visible to the caller; create a group within the configured limit |
| PATCH/DELETE | `/groups/:groupId` | OWNER/ADMIN | Rename/edit/order a group; deletion safely clears the group from its accounts |
| PUT | `/groups/order` | OWNER/ADMIN | Replace the complete group order with every group UUID exactly once |
| PUT | `/:accountId/group` | OWNER/ADMIN or account MANAGE | Assign or clear a single account's group (`{"groupId":null}` clears it) |
| PATCH | `/:accountId/metadata` | OWNER/ADMIN or account MANAGE | Set the internal alias and/or replace tags |
| GET/PUT/DELETE | `/:accountId/access` and `/:accountId/access/:membershipId` | OWNER/ADMIN | List, grant (`VIEW`/`MANAGE`) or revoke access for a MEMBER in the same organization |
| GET | `/preferences` | Organization member | List the caller's favorites/default account among accounts they can access |
| PUT/DELETE | `/:accountId/favorite` | OWNER/ADMIN or account VIEW/MANAGE | Set or clear the caller's favorite |
| PUT/DELETE | `/:accountId/default` | OWNER/ADMIN or account VIEW/MANAGE | Set or clear the caller's one default account; uniqueness is enforced in PostgreSQL |
| GET/PATCH | `/settings` | OWNER/ADMIN | Read or update per-organization active-account and group limits |
| POST | `/bulk/move-group`, `/bulk/tags`, `/bulk/sync` | OWNER/ADMIN or account MANAGE | Process up to 50 account IDs, returning a `SUCCESS`/`FAILED` result for each item |

`OWNER` and `ADMIN` use the existing organization RBAC and have access to all its accounts. `MEMBER` receives `VIEW` or `MANAGE` per account; `VIEW` permits reading and personal preferences, while `MANAGE` also permits alias/tag/group changes and synchronization. Account grants cannot elevate a MEMBER to organization administration. Inaccessible or foreign-tenant account IDs are returned as not found for single-item operations and as `ACCOUNT_NOT_AVAILABLE` in a partial batch. Batch failures do not stop later items. No batch publishing route is provided.

New organization quotas come from `INSTAGRAM_DEFAULT_ORGANIZATION_ACCOUNT_LIMIT` (default 10, range 1–1000) and `INSTAGRAM_DEFAULT_ORGANIZATION_GROUP_LIMIT` (default 20, range 1–200). The migration initializes existing organizations to 10 accounts and 20 groups; new registrations use the configured environment defaults. Changing these defaults does not overwrite persisted quotas. OWNER/ADMIN can update them with `PATCH /settings`. Limits below current active account/group counts are rejected. Account count includes every status except `DISCONNECTED` so pending OAuth and accounts requiring repair still consume a slot. This quota is operational configuration, not billing.

Before disconnecting an account, the API rejects the operation with `409` while any active automation rule or DRAFT/QUEUED/PROCESSING publication depends on it. Deactivate/delete those rules and resolve or cancel those publications, then retry. The OAuth provider and profile synchronization remain the existing MOCK/Meta implementations. Batch synchronization invokes the existing provider path and returns per-account outcomes; tokens remain excluded from all response projections. Group, grant, preference, metadata, settings, synchronization, disconnect, and batch operations write safe audit records.

Example MOCK group and bulk synchronization:

```bash
curl -X POST "http://localhost:3001/api/organizations/ORGANIZATION_ID/instagram/accounts/groups" \
  -H "Authorization: Bearer ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Campaigns","description":"Managed creator accounts"}'

curl -X POST "http://localhost:3001/api/organizations/ORGANIZATION_ID/instagram/accounts/bulk/sync" \
  -H "Authorization: Bearer ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"accountIds":["ACCOUNT_UUID_1","ACCOUNT_UUID_2"]}'
```

## Validation

```bash
docker compose up -d
npm run prisma:generate
npm run migration
npm run seed
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

The e2e suite writes uniquely named test users and organizations into the database selected by `DATABASE_URL`, and its BullMQ workers share Redis queue keys independently of PostgreSQL. Use dedicated local/test PostgreSQL and Redis databases, not production data. For example:

```bash
DATABASE_URL='postgresql://app:app@localhost:5432/instagram_automation_test?schema=public' npm run migration
DATABASE_URL='postgresql://app:app@localhost:5432/instagram_automation_test?schema=public' REDIS_URL=redis://localhost:6379/15 npm run test:e2e
```

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

To schedule a draft, send a timestamp with an explicit UTC offset and a valid IANA timezone. The timestamp defines the absolute instant; the timezone is retained with the publication for display and audit. BullMQ stores the one-time job as delayed until that instant; the API reports it as `WAITING` while it is waiting or delayed. Jobs are deduplicated by their stable publication job ID. A due job may start shortly after its scheduled time depending on worker load.

```bash
curl -X POST "http://localhost:3001/api/organizations/ORGANIZATION_ID/instagram/publications/PUBLICATION_ID/schedule" \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scheduledAt":"2026-11-03T14:30:00-03:00","timezone":"America/Bahia"}'

curl "http://localhost:3001/api/organizations/ORGANIZATION_ID/jobs?state=WAITING" \
  -H "Authorization: Bearer ACCESS_TOKEN"

curl "http://localhost:3001/api/organizations/ORGANIZATION_ID/jobs/metrics" \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

Failed BullMQ jobs remain in the publication queue as the dead-letter/failed set (up to 5,000 retained failures). After resolving the cause, an Owner or Admin can retry one with `POST /api/organizations/:organizationId/jobs/publications/:publicationId/retry`. The manual retry resets BullMQ's attempt counters; publication attempt history in PostgreSQL remains cumulative. Cancellation removes waiting/delayed jobs when possible and is rejected once processing starts.

The publication worker uses exponential backoff and configured attempts. Development defaults keep publication, webhook, and automation worker concurrency at one. Publication rate limiting uses Redis atomic fixed-window counters per organization and Instagram account. Tune `PUBLICATION_WORKER_CONCURRENCY`, `WEBHOOK_WORKER_CONCURRENCY`, `AUTOMATION_WORKER_CONCURRENCY`, `PUBLICATION_MAX_ATTEMPTS`, `PUBLICATION_RETRY_DELAY_MS`, `PUBLICATION_ORGANIZATION_RATE_LIMIT_MAX`, `PUBLICATION_ACCOUNT_RATE_LIMIT_MAX`, and `PUBLICATION_RATE_LIMIT_WINDOW_MS` in `.env`. The default per-window limits are 20 publications per organization and 5 per Instagram account per 60 seconds. Redis is configured with append-only persistence and `noeviction` in Docker Compose.

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

### Hardening, audit and observability

- `AuditLog` records login/logout and failed login attempts, user registration, Instagram connection/disconnection, publication requests and worker outcomes, automation rule changes/executions, media operations, and organization membership administration. Records are scoped by organization and user where known. Audit metadata is allowlisted; credentials, request bodies, captions, webhook payloads, and token values are never persisted there.
- Owners and Admins can read their organization's audit history at `GET /api/organizations/:organizationId/audit-logs?page=&pageSize=&action=&userId=`. Normal tenant and role guards apply.
- Every request gets a validated or generated `X-Correlation-ID`, returned in the response and attached to structured request logs and audit rows. Request log serializers omit query strings, headers, and bodies; sensitive fields are also redacted. Error responses contain no stack traces, and production 5xx messages are generic.
- `/health` includes service liveness and uptime. `/ready` checks PostgreSQL and Redis independently and reports dependency availability without connection details. `/metrics` exposes process and route-level HTTP counters in Prometheus text format; restrict access at the ingress if external scraping is not intended.
- General HTTP limits use Redis-backed fixed windows (`THROTTLE_TTL_MS`, `THROTTLE_LIMIT`); login and registration have a five-request-per-minute limit. `TRUST_PROXY_HOPS=0` is the safe default. Set the exact trusted proxy hop count before using forwarded client IPs.
- Helmet and strict DTO validation are enabled. Production requires explicit HTTPS `CORS_ORIGIN` values and limits `LOG_LEVEL` to `info` or quieter. Keep JWT, Instagram encryption, media signing, database, and Redis credentials in a deployment secret manager.
- Audit records and webhook events are pruned on `RETENTION_CLEANUP_INTERVAL_MS` (daily by default). `AUDIT_LOG_RETENTION_DAYS` and `WEBHOOK_EVENT_RETENTION_DAYS` default to 365. Expiring webhook rows also cascades to their dependent automation execution records. Raw webhook payload storage remains disabled by default.

The audit/observability tests verify that another tenant cannot read audit history, correlation IDs flow into audit entries, rate limiting and security headers are active, and credential sentinels do not appear in emitted request logs.

### Media library

Media uploads are written to a temporary disk file, checked against their file signature and configured size limit, then streamed to the selected storage provider. PostgreSQL stores only asset metadata, SHA-256, and a storage key. The local provider stores objects beneath `MEDIA_LOCAL_ROOT`; the S3 provider uses the AWS SDK credential chain and multipart uploads. Supported MIME types are JPEG, PNG, WebP, MP4, and QuickTime video. `MEDIA_MAX_FILE_SIZE_BYTES` defaults to 100 MiB.

Tenant-scoped media routes:

- `POST /api/organizations/:organizationId/media-assets?deduplicate=true` — upload the multipart field `file`; hash deduplication is optional
- `GET /api/organizations/:organizationId/media-assets?page=&pageSize=&search=&publicationId=` — search and paginate assets
- `GET /api/organizations/:organizationId/media-assets/:assetId` — read metadata
- `GET /api/organizations/:organizationId/media-assets/:assetId/content` — stream through authenticated tenant access
- `GET /api/organizations/:organizationId/media-assets/:assetId/signed-url` — create a temporary read URL
- `DELETE /api/organizations/:organizationId/media-assets/:assetId` — delete the object and metadata; assets used by draft or queued publications are protected
- `POST /api/organizations/:organizationId/media-assets/cleanup-orphans` — remove unreferenced storage objects older than `MEDIA_ORPHAN_GRACE_HOURS`

Create a publication with `mediaAssetId` instead of `mediaUrl`. The asset must belong to the organization and its detected image/video type must match the publication. The publishing worker creates a short-lived read URL at processing time, so a future scheduled post does not depend on a URL signed when the draft was created. After a publication reaches a terminal state, deleting its asset detaches the metadata reference from publication history.

Set `MEDIA_STORAGE_PROVIDER=S3`, `S3_BUCKET`, and `S3_REGION` for S3. Configure `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` only when the runtime does not already provide AWS credentials; IAM roles and other SDK credential providers also work. `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE` support compatible object stores. Local signed URLs use `MEDIA_PUBLIC_API_URL` and `MEDIA_URL_SIGNING_SECRET`; provide a publicly reachable API base when an external provider needs to fetch local media. Keep the storage provider and bucket configuration stable for objects already stored.

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
