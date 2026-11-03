import { expect, test, type Page } from './fixtures';

const organizationId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const publicationId = '33333333-3333-4333-8333-333333333333';
const ruleId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';
const privatePayload = 'private-comment-must-not-render-ops-dashboard';

test('exposes only normalized backend readiness states', async ({ page }) => {
  const response = await page.goto('/api/operations/health');
  expect(response?.status()).toBe(200);
  const body = await response?.json();
  expect(body).toMatchObject({ api: 'ok', postgres: 'ok', redis: 'ok' });
  expect(JSON.stringify(body)).not.toMatch(/localhost|password|token|secret|stack/i);
});

test('shows MOCK operations data, filters audit records, and links to operational pages', async ({ page }) => {
  await mockOperationsData(page);
  await registerOwner(page, 'Operations dashboard workspace');

  await expect(page.getByRole('heading', { name: /Operations dashboard/ })).toBeVisible();
  await expect(page.getByText('1 connected · MOCK')).toBeVisible();
  await expect(page.getByText('Connected accounts')).toBeVisible();
  await expect(page.getByText('12', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Publications by status' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Queue health' })).toBeVisible();
  await expect(page.getByText('Active automations')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent Instagram events' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent errors' })).toBeVisible();
  await expect(page.getByText('Publication job failed')).toBeVisible();
  await expect(page.getByText('Automation execution failed · review the rule history')).toBeVisible();

  for (const href of [
    '/instagram/accounts',
    '/instagram/publications',
    '/automations',
    '/instagram/scheduler',
    '#audit-log',
  ]) {
    await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible();
  }

  await page.getByLabel('Filter audit action').selectOption('LOGIN_FAILED');
  await page.getByLabel('Filter by user ID').fill(userId);
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'LOGIN_FAILED' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'PUBLICATION_FAILED' })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(privatePayload);
  await expect(page.locator('body')).not.toContainText(/access.?token|refresh.?token|encrypted.?token/i);
});

test('keeps queue and audit data out of a member dashboard', async ({ page, request }) => {
  const backendUrl = process.env.BACKEND_API_URL ?? 'http://127.0.0.1:3003';
  await mockOperationsData(page);
  const restrictedRequests: string[] = [];
  page.on('request', (requestEvent) => {
    const requestUrl = requestEvent.url();
    if (requestUrl.includes('/jobs/metrics') || requestUrl.includes('/audit-logs')) {
      restrictedRequests.push(requestUrl);
    }
  });

  const ownerEmail = `ops-owner-${Date.now()}@example.com`;
  const memberEmail = `ops-member-${Date.now()}@example.com`;
  const password = 'Operations-member-test-2026!';
  const memberRegistration = await request.post(`${backendUrl}/api/auth/register`, {
    data: { email: memberEmail, password, organizationName: 'Member home' },
    headers: { 'X-Forwarded-For': '198.51.100.250' },
  });
  expect(memberRegistration.status()).toBe(201);

  await page.goto('/register');
  await page.getByLabel('Organization name').fill('Owner operations workspace');
  await page.getByLabel('Email address').fill(ownerEmail);
  await page.getByLabel('Password').fill(password);
  const ownerRegistration = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/register') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create workspace' }).click();
  const ownerResult = await ownerRegistration;
  const owner = await ownerResult.json() as { organizationId: string };
  await expect(page).toHaveURL(/\/dashboard$/);

  const memberAdded = await page.evaluate(async ({ targetOrganizationId, email }) => {
    const response = await fetch(`/api/backend/organizations/${targetOrganizationId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return response.status;
  }, { targetOrganizationId: owner.organizationId, email: memberEmail });
  expect(memberAdded).toBe(201);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  const memberLogin = await page.evaluate(async ({ email, password, organizationId: targetOrganizationId }) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, organizationId: targetOrganizationId }),
    });
    return response.status;
  }, { email: memberEmail, password, organizationId: owner.organizationId });
  expect(memberLogin).toBe(200);
  restrictedRequests.length = 0;
  await page.goto('/dashboard');

  await expect(page.getByText('Member workspace')).toBeVisible();
  await expect(page.getByText('Restricted overview').first()).toBeVisible();
  await expect(page.getByText('Audit records are visible to organization owners and admins.')).toBeVisible();
  await expect(page.locator('a[href="/instagram/scheduler"]')).toHaveCount(0);
  await expect(page.locator('a[href="#audit-log"]')).toHaveCount(0);
  await expect(page.locator('a[href="/instagram/accounts"]').first()).toBeVisible();

  expect(restrictedRequests).toEqual([]);
});

async function registerOwner(page: Page, organizationName: string) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.goto('/register');
  await page.getByLabel('Organization name').fill(`${organizationName} ${suffix}`);
  await page.getByLabel('Email address').fill(`ops-${suffix}@example.com`);
  await page.getByLabel('Password').fill('Operations-owner-test-2026!');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function mockOperationsData(page: Page) {
  await page.route('**/api/operations/health', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: { api: 'ok', postgres: 'ok', redis: 'ok', checkedAt: '2026-11-03T12:00:00.000Z' },
  }));
  await page.route('**/api/backend/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/backend/', '');
    if (path.endsWith('/instagram/accounts') && route.request().method() === 'GET') {
      return route.fulfill({ json: [mockAccount()] });
    }
    if (path.endsWith('/jobs/metrics')) {
      return route.fulfill({ json: { queue: 'instagram-publications', generatedAt: '2026-11-03T12:00:00.000Z', states: { WAITING: 2, PROCESSING: 1, COMPLETED: 12, FAILED: 1, CANCELED: 0 }, deadLetter: 1 } });
    }
    if (path.endsWith('/jobs')) {
      return route.fulfill({ json: { items: [mockFailedJob()], page: 1, pageSize: 5, total: 1, totalPages: 1 } });
    }
    if (path.endsWith('/instagram/publications')) {
      const status = url.searchParams.get('status') ?? '';
      const totals: Record<string, number> = { DRAFT: 3, QUEUED: 2, PROCESSING: 1, PUBLISHED: 12, FAILED: 1, CANCELED: 0 };
      return route.fulfill({ json: { items: [], page: 1, pageSize: 1, total: totals[status] ?? 19, totalPages: totals[status] ?? 19 ? 1 : 0 } });
    }
    if (path.endsWith('/automation-rules')) {
      return route.fulfill({ json: [
        { id: ruleId, organizationId, instagramAccountId: accountId, name: 'Welcome comments', active: true, triggerType: 'COMMENT_RECEIVED', conditions: { match: 'ALL', rules: [] }, actions: [{ type: 'REGISTER_EVENT' }], createdAt: '2026-11-03T11:00:00.000Z', updatedAt: '2026-11-03T11:00:00.000Z' },
        { id: '66666666-6666-4666-8666-666666666666', organizationId, instagramAccountId: accountId, name: 'Paused rule', active: false, triggerType: 'MESSAGE_RECEIVED', conditions: { match: 'ALL', rules: [] }, actions: [{ type: 'REGISTER_EVENT' }], createdAt: '2026-11-03T10:00:00.000Z', updatedAt: '2026-11-03T10:00:00.000Z' },
      ] });
    }
    if (path.endsWith('/automation-executions')) {
      return route.fulfill({ json: { items: [mockFailedExecution()], page: 1, pageSize: 5, total: 1 } });
    }
    if (path.endsWith('/instagram/events')) {
      const failed = url.searchParams.get('status') === 'error';
      return route.fulfill({ json: { items: [mockEvent(failed)], page: 1, pageSize: 5, total: failed ? 1 : 1, totalPages: 1 } });
    }
    if (path.endsWith('/audit-logs')) {
      const action = url.searchParams.get('action');
      const filtered = action === 'LOGIN_FAILED';
      const entries = filtered ? [mockAuditEntry('LOGIN_FAILED', 'FAILURE')] : [mockAuditEntry('LOGIN', 'SUCCESS'), mockAuditEntry('PUBLICATION_FAILED', 'FAILURE')];
      return route.fulfill({ json: { items: entries, page: Number(url.searchParams.get('page') ?? 1), pageSize: 8, total: entries.length, totalPages: 1 } });
    }
    return route.continue();
  });
}

function mockAccount() {
  return { id: accountId, organizationId, provider: 'MOCK', externalAccountId: null, username: 'mock_brand', name: 'Mock Brand', avatarUrl: null, status: 'CONNECTED', tokenExpiresAt: null, connectedAt: '2026-11-01T12:00:00.000Z', disconnectedAt: null, lastSyncedAt: '2026-11-03T11:45:00.000Z', lastError: null, createdAt: '2026-11-01T12:00:00.000Z', updatedAt: '2026-11-03T11:45:00.000Z' };
}

function mockFailedJob() {
  return { id: 'job-failed-1', domain: 'INSTAGRAM_PUBLICATION', name: 'publish-instagram', publicationId, instagramAccountId: accountId, instagramAccount: { id: accountId, username: 'mock_brand', name: 'Mock Brand' }, state: 'FAILED', queueState: 'failed', attemptsMade: 3, maxAttempts: 3, scheduledAt: null, timezone: null, enqueuedAt: '2026-11-03T10:00:00.000Z', startedAt: '2026-11-03T10:00:05.000Z', finishedAt: '2026-11-03T10:00:10.000Z', errorCode: 'PROVIDER_UNAVAILABLE', createdAt: '2026-11-03T10:00:00.000Z', updatedAt: '2026-11-03T10:00:10.000Z' };
}

function mockFailedExecution() {
  return { id: 'execution-failed-1', instagramAccountId: accountId, automationRuleId: ruleId, webhookEventId: '77777777-7777-4777-8777-777777777777', status: 'FAILED', result: null, errorCode: 'ACTION_FAILED', createdAt: '2026-11-03T10:15:00.000Z', startedAt: '2026-11-03T10:15:00.000Z', finishedAt: '2026-11-03T10:15:03.000Z', automationRule: { id: ruleId, name: 'Welcome comments' }, actionExecutions: [] };
}

function mockEvent(failed: boolean) {
  return { id: failed ? 'event-failed-1' : 'event-recent-1', provider: 'MOCK', externalEventId: 'mock-event-1', instagramAccountId: accountId, accountUsername: 'mock_brand', accountName: 'Mock Brand', eventType: 'instagram.change', field: 'comments', status: failed ? 'FAILED' : 'PROCESSED', receivedAt: failed ? '2026-11-03T10:30:00.000Z' : '2026-11-03T11:30:00.000Z', processedAt: '2026-11-03T11:30:02.000Z', error: 'do-not-render-raw-event-error', normalizedPayload: { text: privatePayload } };
}

function mockAuditEntry(action: string, outcome: 'SUCCESS' | 'FAILURE'): Record<string, unknown> {
  return { id: `audit-${action}`, organizationId, userId, action, resourceType: action.startsWith('PUBLICATION') ? 'publication' : 'session', resourceId: publicationId, outcome, correlationId: 'safe-correlation-id', metadata: { statusCode: outcome === 'SUCCESS' ? 200 : 401 }, createdAt: '2026-11-03T11:50:00.000Z' };
}
