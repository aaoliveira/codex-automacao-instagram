import { expect, test } from '@playwright/test';

test('creates a MOCK Reel in the browser and follows it to PUBLISHED', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `publishing-${suffix}@example.com`;

  await page.goto('/register');
  await page.getByLabel('Organization name').fill(`Publishing Workspace ${suffix}`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('Publishing-mock-workspace-2026!');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto('/instagram/accounts');
  await page.getByRole('button', { name: 'Connect your first account' }).click();
  const mockDialog = page.getByRole('dialog', { name: 'Complete mock connection' });
  await expect(mockDialog.getByText('MOCK provider')).toBeVisible();
  await mockDialog.getByRole('button', { name: 'Simulate approval' }).click();
  await expect(
    page.getByRole('status').getByText('Instagram account connected successfully.'),
  ).toBeVisible();

  await page.goto('/instagram/compose');
  await expect(page.getByRole('heading', { name: /Create a post/ })).toBeVisible();
  const accountSelect = page.getByRole('combobox', { name: 'Instagram account' });
  await expect(accountSelect.locator('option')).toHaveCount(2);
  await accountSelect.selectOption({ index: 1 });
  await page.getByRole('radio', { name: /Reel/ }).click();
  await page.getByLabel('Public media URL').fill(`https://cdn.example.test/${suffix}.mp4`);
  await page.getByLabel('Caption').fill('A first Reel, published from the Social Console.');
  await expect(page.getByLabel('Reel preview')).toBeVisible();
  await expect(page.getByLabel('Also share to feed')).toBeChecked();

  await page.getByRole('button', { name: 'Publish now' }).click();
  await expect(page).toHaveURL(/\/instagram\/publications\/[0-9a-f-]+$/, { timeout: 30_000 });
  await expect(page.locator('[data-status="PUBLISHED"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Instagram confirmed this post was published.')).toBeVisible();
  await expect(page.getByText('A first Reel, published from the Social Console.')).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/workspace_access|workspace_refresh|Bearer\s/i);

  const publicationId = new URL(page.url()).pathname.split('/').at(-1);
  await page.goto('/instagram/publications');
  await expect(page.getByRole('heading', { name: /Publishing history/ })).toBeVisible();
  const row = page.locator(`a[href="/instagram/publications/${publicationId}"]`);
  await expect(row).toContainText('A first Reel, published from the Social Console.');
  await expect(row.locator('[data-status="PUBLISHED"]')).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/instagram/publications/${publicationId}$`));
  await expect(page.locator('[data-status="PUBLISHED"]')).toBeVisible();

  await page.goto('/instagram/compose');
  await page.getByRole('combobox', { name: 'Instagram account' }).selectOption({ index: 1 });
  await page.getByLabel('Public media URL').fill(`https://cdn.example.test/${suffix}.jpg`);
  await page.getByLabel('Caption').fill('A saved draft for a later day.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status').getByText('Draft saved to your publishing history.')).toBeVisible();
  await page.getByRole('link', { name: 'Open draft' }).click();
  await expect(page.locator('[data-status="DRAFT"]')).toBeVisible();
  await expect(page.getByText('A saved draft for a later day.')).toBeVisible();
});
