import { expect, test } from '@playwright/test';

test('creates and filters a MOCK event, then opens its safe details', async ({
  page,
  request,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const eventMarker = `private-payload-${suffix}`;
  const backendUrl =
    process.env.BACKEND_API_URL ?? 'http://127.0.0.1:3003';

  await page.goto('/register');
  await page.getByLabel('Organization name').fill(`Events Workspace ${suffix}`);
  await page.getByLabel('Email address').fill(`events-${suffix}@example.com`);
  await page.getByLabel('Password').fill('Events-mock-workspace-2026!');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto('/instagram/accounts');
  await page.getByRole('button', { name: 'Connect account' }).click();
  const mockDialog = page.getByRole('dialog', {
    name: 'Complete mock connection',
  });
  await expect(mockDialog).toBeVisible();
  const accountsResponse = page.waitForResponse((response) =>
    response.url().includes('/api/backend/organizations/') &&
    response.url().endsWith('/instagram/accounts') &&
    response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: 'Simulate approval' }).click();
  const accountResponse = await accountsResponse;
  const accounts = (await accountResponse.json()) as Array<{
    id: string;
    externalAccountId: string;
    username: string;
  }>;
  const account = accounts[0];
  expect(account?.externalAccountId).toBeTruthy();

  const createdEvent = await request.post(
    `${backendUrl}/api/webhooks/instagram/mock`,
    {
      data: {
        eventType: 'instagram.change',
        externalEventId: `e2e-${suffix}`,
        entryId: account.externalAccountId,
        field: 'comments',
        data: { text: eventMarker },
      },
    },
  );
  expect(createdEvent.status()).toBe(202);

  await page.goto('/instagram/events');
  await expect(
    page.getByRole('heading', { name: 'Events inbox', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Instagram account').selectOption(account.id);
  await page.getByLabel('Event type').selectOption('comments');
  // MOCK profile names can repeat across runs; newest-first keeps this tied to the event just created.
  const eventRow = page.locator('article').filter({ hasText: account.username }).first();
  await expect(eventRow.getByText('Comment update')).toBeVisible({
    timeout: 20_000,
  });
  await expect(eventRow.getByText('MOCK', { exact: true })).toBeVisible();
  await expect(eventRow.getByText('Processed', { exact: true })).toBeVisible({
    timeout: 25_000,
  });

  await page.getByLabel('Processing status').selectOption('processed');
  await expect(eventRow.getByText('Comment update')).toBeVisible();
  await eventRow.getByRole('button', { name: 'View details for Comment update' }).click();
  const details = page.getByRole('dialog', { name: 'Comment update' });
  await expect(details.getByText('@' + account.username)).toBeVisible();
  await expect(details.getByText('MOCK provider')).toBeVisible();
  await expect(details).not.toContainText(eventMarker);
  await expect(details).not.toContainText(/rawPayload|access.?token|encrypted/i);

  await page.getByLabel('Event type').selectOption('messages');
  await expect(page.getByText('No events match these filters')).toBeVisible();
});
