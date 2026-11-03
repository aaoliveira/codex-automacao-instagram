import { expect, test } from './fixtures';

test('schedules a MOCK draft, edits the slot with a replacement, and cancels it', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `scheduler-${suffix}@example.com`;
  const firstCaption = `Scheduler first draft ${suffix}`;
  const replacementCaption = `Scheduler replacement draft ${suffix}`;

  await page.goto('/register');
  await page.getByLabel('Organization name').fill(`Scheduler Workspace ${suffix}`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('Scheduler-mock-workspace-2026!');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto('/instagram/accounts');
  await page.getByRole('button', { name: 'Connect your first account' }).click();
  const mockDialog = page.getByRole('dialog', { name: 'Complete mock connection' });
  await expect(mockDialog.getByText('MOCK provider')).toBeVisible();
  await mockDialog.getByRole('button', { name: 'Simulate approval' }).click();
  await expect(page.getByRole('status').getByText('Instagram account connected successfully.')).toBeVisible();

  await page.goto('/instagram/compose');
  await createPhotoDraft(page, firstCaption, `${suffix}-first`);
  await createPhotoDraft(page, replacementCaption, `${suffix}-replacement`);

  await page.goto('/instagram/scheduler');
  await expect(page.getByRole('heading', { name: 'Scheduler.' })).toBeVisible();
  await page.getByRole('button', { name: 'Schedule a post' }).first().click();
  const scheduleDialog = page.getByRole('dialog', { name: 'Schedule a post' });
  await scheduleDialog.getByRole('combobox', { name: 'Instagram account' }).selectOption({ index: 1 });
  await scheduleDialog.getByRole('combobox', { name: 'Publication draft' }).selectOption({ label: `Photo post · ${firstCaption}` });
  await scheduleDialog.getByLabel('Timezone').fill('UTC');
  await scheduleDialog.getByLabel('Scheduling date').fill(await pastUtcDate(1));
  await expect(scheduleDialog.getByRole('button', { name: 'Schedule publication' })).toBeDisabled();
  await expect(scheduleDialog.getByText('Choose a date and time in the future.')).toBeVisible();
  const firstDate = await futureUtcDate(2);
  await scheduleDialog.getByLabel('Scheduling date').fill(firstDate);
  await scheduleDialog.getByLabel('Scheduling time').fill('20:15');
  await expect(scheduleDialog.getByRole('button', { name: 'Schedule publication' })).toBeEnabled();
  await scheduleDialog.getByRole('button', { name: 'Schedule publication' }).click();
  await expect(page.getByRole('status').getByText('Publication scheduled successfully.')).toBeVisible();

  const calendar = page.getByRole('region', { name: 'Publication calendar' });
  await navigateCalendarToDate(page, calendar, firstDate);
  await expect(calendar.getByRole('button', { name: new RegExp(firstCaption) })).toBeVisible();
  await page.getByRole('button', { name: 'Week' }).click();
  await expect(page.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Month' }).click();

  const scheduledList = page.getByRole('region', { name: 'Scheduled jobs' });
  const firstRow = scheduledList.locator('article').filter({ hasText: firstCaption });
  await expect(firstRow.locator('[data-job-state="WAITING"]')).toBeVisible();
  await page.getByLabel('Filter by Instagram account').selectOption({ index: 1 });
  await page.getByLabel('Filter by job status').selectOption('WAITING');
  await expect(firstRow).toBeVisible();
  await page.getByLabel('Filter by job status').selectOption('');
  await page.getByLabel('Filter by Instagram account').selectOption('');
  await firstRow.getByRole('button', { name: 'Edit' }).click();

  const editDialog = page.getByRole('dialog', { name: 'Edit scheduled post' });
  await editDialog.getByRole('combobox', { name: 'Instagram account' }).selectOption({ index: 1 });
  await editDialog.getByRole('combobox', { name: 'Replacement draft' }).selectOption({ label: `Photo post · ${replacementCaption}` });
  const replacementDate = await futureUtcDate(4);
  await editDialog.getByLabel('Scheduling date').fill(replacementDate);
  await editDialog.getByLabel('Scheduling time').fill('18:45');
  await editDialog.getByLabel('Timezone').fill('UTC');
  await editDialog.getByRole('button', { name: 'Review schedule change' }).click();
  const replaceConfirmation = editDialog.getByRole('alertdialog', { name: 'Confirm schedule change' });
  await replaceConfirmation.getByRole('button', { name: 'Confirm replacement' }).click();
  await expect(page.getByRole('status').getByText(/Schedule updated with the replacement draft/)).toBeVisible();
  await expect(firstRow.locator('[data-job-state="CANCELED"]')).toBeVisible();

  const replacementRow = scheduledList.locator('article').filter({ hasText: replacementCaption });
  await expect(replacementRow.locator('[data-job-state="WAITING"]')).toBeVisible();
  await replacementRow.getByRole('button', { name: 'Cancel' }).click();
  const cancelConfirmation = page.getByRole('alertdialog', { name: 'Cancel scheduled publication?' });
  await cancelConfirmation.getByRole('button', { name: 'Cancel publication' }).click();
  await expect(page.getByRole('status').getByText('Scheduled publication canceled.')).toBeVisible();
  await expect(replacementRow.locator('[data-job-state="CANCELED"]')).toBeVisible();
});

async function createPhotoDraft(page: import('@playwright/test').Page, caption: string, mediaId: string) {
  const account = page.getByRole('combobox', { name: 'Instagram account' });
  await account.selectOption({ index: 1 });
  await page.getByLabel('Public media URL').fill(`https://cdn.example.test/${mediaId}.jpg`);
  await page.getByLabel('Caption').fill(caption);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status').getByText('Draft saved to your publishing history.')).toBeVisible();
}

async function futureUtcDate(daysAhead: number): Promise<string> {
  return new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function pastUtcDate(daysAgo: number): Promise<string> {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function navigateCalendarToDate(
  page: import('@playwright/test').Page,
  calendar: import('@playwright/test').Locator,
  date: string,
) {
  const targetHeading = await page.evaluate((dateString) => {
    const atNineUtc = new Date(`${dateString}T09:00:00Z`);
    return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(atNineUtc);
  }, date);
  const heading = calendar.getByRole('heading', { level: 2 });
  if ((await heading.innerText()) !== targetHeading) {
    await page.getByRole('button', { name: 'Next calendar period' }).click();
  }
  await expect(heading).toHaveText(targetHeading);
}
