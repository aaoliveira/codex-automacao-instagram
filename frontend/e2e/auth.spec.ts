import { expect, test } from './fixtures';

test('redirects an unauthenticated visitor away from the dashboard', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
});

test('registers through the backend, protects the dashboard, and signs in again', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `playwright-${suffix}@example.com`;
  const password = 'Playwright-workspace-2026!';

  await page.goto('/register');
  await page.getByLabel('Organization name').fill(`Playwright Workspace ${suffix}`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: /Operations dashboard/ })).toBeVisible();
  await expect(page.locator('header').getByText(email)).toBeVisible();
  await expect(page.getByText('Owner workspace')).toBeVisible();
  const cookies = await page.context().cookies();
  for (const name of ['workspace_access', 'workspace_refresh']) {
    const cookie = cookies.find((item) => item.name === name);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
  }
  expect(await page.evaluate(() => document.cookie)).not.toContain('workspace_access');
  expect(await page.evaluate(() => document.cookie)).not.toContain('workspace_refresh');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.context().cookies()).some((item) => item.name.startsWith('workspace_'))).toBe(false);

  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: /Operations dashboard/ })).toBeVisible();
  await expect(page.locator('header').getByText(email)).toBeVisible();
});
