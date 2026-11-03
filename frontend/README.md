# Instagram Automation Platform — Frontend

Separate Next.js App Router application for the backend foundation. It provides registration, login, a protected workspace dashboard, team visibility, permission-aware navigation, Instagram professional account management, a media library, a read-only Instagram events inbox, Instagram publishing drafts/history, and a simple automation rule editor with execution history.

## Requirements

- Node.js 20.9 or newer (Node 24 recommended)
- npm
- The backend and its PostgreSQL/Redis services running at the URLs configured below

## Local setup

In the repository root, start the backend dependencies and API following the root [README](../README.md). Then:

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

The frontend is available at `http://localhost:3000`. `BACKEND_API_URL` is server-only. Browser requests go through Next.js Route Handlers, which proxy to the backend and keep access/refresh tokens out of JavaScript. Leave `BACKEND_TRUST_PROXY_HEADERS=false` unless a trusted ingress strips client-supplied forwarding headers; when enabled, configure the backend `TRUST_PROXY_HOPS` to match the deployment proxy chain.

Use the owner credentials configured in the backend `.env` seed to sign in, or create an account on the registration page. In production, deploy this app to Vercel and set `BACKEND_API_URL` to the reachable backend origin. The app uses no local file or database state and is compatible with Vercel's Node.js runtime.

Open `/instagram/accounts` to list, connect, synchronize, or disconnect accounts. With the backend's default `INSTAGRAM_PROVIDER=MOCK`, the page offers a local simulated approval dialog and requires no Meta credentials. For real Meta OAuth, set the backend `META_INSTAGRAM_REDIRECT_URI` and the matching URI in the Meta App Dashboard to `http://localhost:3000/api/instagram/oauth/callback` (use the deployed frontend origin in production). The frontend callback forwards the provider code/state to the backend and redirects back to the accounts page; the backend must use the exact same redirect URI during token exchange.

Open `/instagram/events` to review paginated Instagram webhook events. The inbox supports account, comments/messages/other type, and pending/processed/error filters, refreshes every 10 seconds while its tab is active, and shows only a safe event summary. Its read API is tenant-scoped and never returns the stored raw webhook payload:

- `GET /api/organizations/:organizationId/instagram/events?page=&pageSize=&accountId=&type=&status=`
- `GET /api/organizations/:organizationId/instagram/events/:eventId`

In local MOCK mode, create an event through `POST /api/webhooks/instagram/mock` with `entryId` set to the connected account's `externalAccountId`, then open the inbox. Event reads require the same authenticated organization as the URL.

Open `/media` to upload and manage organization-owned photos and videos. The page supports drag-and-drop, upload progress, previews, filename search, image/video filters, grid/list views, paginated loading, and confirmed deletion. Upload and delete controls are available to Owners and Admins; all organization members can browse and select media. Choose `Use in Composer` from a file card or select a file inside `/instagram/compose`. The browser sends files through the same-origin Next.js proxy, which keeps the backend session cookies HttpOnly and forwards the multipart boundary; image/video previews are streamed through the authenticated proxy. The backend validates the file and enforces tenant isolation and size limits.

The media library calls these tenant-scoped endpoints through the same-origin proxy:

- `POST /api/organizations/:organizationId/media-assets?deduplicate=true` — multipart upload using the `file` field
- `GET /api/organizations/:organizationId/media-assets?page=&pageSize=&search=` — list, search, and paginate
- `GET /api/organizations/:organizationId/media-assets/:assetId` — read metadata
- `GET /api/organizations/:organizationId/media-assets/:assetId/content` — authenticated preview stream
- `DELETE /api/organizations/:organizationId/media-assets/:assetId` — delete a file when it is not used by an active draft or queued post

Open `/instagram/compose` to save an Instagram publication draft or publish it immediately, `/instagram/publications` to review history, and `/instagram/scheduler` to manage queued jobs. The composer selects a connected account, supports photo/video/Reel formats, selects an uploaded media asset or a public HTTPS URL, validates the caption and media type, and shows an Instagram-style preview. The scheduler provides monthly and weekly calendar views, account/status filters, scheduled draft creation, cancellation, and retry for failed jobs. Date and time are interpreted in the selected IANA timezone; calendar dates use the browser timezone and each event displays its stored timezone. An existing queued job cannot be updated by the current API, so editing replaces it with a selected draft and cancels the previous job after the replacement is queued.

The publishing UI calls these tenant-scoped backend endpoints through the same-origin Next.js proxy:

- `POST /api/organizations/:organizationId/instagram/publications` — save a draft with an idempotency key
- `POST /api/organizations/:organizationId/instagram/publications/:publicationId/publish` — publish now
- `GET /api/organizations/:organizationId/instagram/publications?page=&pageSize=&instagramAccountId=&status=` — filtered history
- `GET /api/organizations/:organizationId/instagram/publications/:publicationId` — status and details
- `POST /api/organizations/:organizationId/instagram/publications/:publicationId/schedule` — schedule a saved draft
- `GET /api/organizations/:organizationId/jobs?page=&pageSize=` — list tenant publication jobs
- `POST /api/organizations/:organizationId/jobs/publications/:publicationId/retry` — retry a failed job
- `POST /api/organizations/:organizationId/jobs/publications/:publicationId/cancel` — cancel a job that has not started

The browser never receives Instagram access tokens. The API response also omits the source media URL from history and detail views.

Open `/automations` to create and manage rules for connected Instagram accounts. The editor uses a concise trigger → conditions → actions form and validates the rule before saving. Owners and Admins can edit, activate/pause, duplicate, delete, and test rules; other organization members can view rules and run history. A rule can be tested only on a connected MOCK account. The test sends a local comment/message event through the backend worker and displays the recorded `SUCCESS`, `FAILED`, or `SKIPPED` result and action statuses. Execution history refreshes automatically while processing.

The `/dashboard` page is the operations overview. It summarizes connected Instagram accounts, publication counts by status, queue metrics, active automations, recent events, recent failures, and API/PostgreSQL/Redis health. Owners and Admins can filter audit history by action or user ID and open queue metrics; Members see a restricted placeholder and the frontend does not request those admin-only endpoints. Event and audit summaries omit message payloads, provider errors, credentials, and token fields.

The automation UI calls these tenant-scoped endpoints through the same-origin proxy:

- `POST /api/organizations/:organizationId/automation-rules` — create a rule
- `GET /api/organizations/:organizationId/automation-rules` — list rules
- `PATCH /api/organizations/:organizationId/automation-rules/:ruleId` — edit or activate/pause
- `DELETE /api/organizations/:organizationId/automation-rules/:ruleId` — deactivate and remove from the list
- `POST /api/organizations/:organizationId/automation-rules/:ruleId/simulate` — queue a MOCK test event
- `GET /api/organizations/:organizationId/automation-executions?page=&pageSize=` — list recent executions and action results

The browser only receives the safe rule, execution, and action summaries returned by these API endpoints; it never receives Instagram access tokens.

## Authentication and session handling

- Next.js calls the NestJS REST API through a same-origin backend proxy.
- The access JWT and opaque refresh token are stored in separate `HttpOnly`, `SameSite=Lax` cookies. `Secure` is enabled in production.
- Login and registration responses sent to the browser omit tokens.
- Server-rendered protected routes verify the access token with `GET /api/auth/me`. An expired access token is refreshed through a Route Handler, which rotates the refresh token and updates cookies.
- The backend remains authoritative for tenant isolation and roles. Hiding a navigation item is only a visual affordance; protected API operations are still authorized by NestJS.

## Commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The production build uses Next.js Webpack compilation, with TypeScript validation included.

Playwright starts the backend and frontend on `127.0.0.1:3003` and `127.0.0.1:3002` so the e2e run uses the current source instead of reusing a possibly older API on the standard development port. The test server uses Redis logical database 14 by default so its BullMQ jobs stay separate from local development; set `PLAYWRIGHT_REDIS_URL` to override it. The test servers enable trusted proxy forwarding only for the local run; production remains disabled by default. E2e tests verify authentication, MOCK account connection/sync/disconnect, media upload/search/preview/Composer selection/publication/deletion, creating a MOCK Reel through the final `PUBLISHED` status and history, scheduling/replacing/canceling MOCK posts, creating/testing/managing a MOCK automation rule through its recorded execution, and operational metrics, audit filters, and member permissions. They require the backend `.env`, Docker services and Chromium (`npx playwright install chromium` if needed).
