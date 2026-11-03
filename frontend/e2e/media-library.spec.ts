import { expect, test } from '@playwright/test';

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

test('uploads an image, selects it in Composer, publishes MOCK, and deletes it', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `media-${suffix}@example.com`;
  const fileName = `creator-photo-${suffix}.png`;

  await page.goto('/register');
  await page.getByLabel('Organization name').fill(`Media Workspace ${suffix}`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('Media-mock-workspace-2026!');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto('/instagram/accounts');
  await page.getByRole('button', { name: 'Connect your first account' }).click();
  const mockDialog = page.getByRole('dialog', { name: 'Complete mock connection' });
  await mockDialog.getByRole('button', { name: 'Simulate approval' }).click();
  await expect(page.getByRole('status').getByText('Instagram account connected successfully.')).toBeVisible();

  await page.goto('/media');
  await expect(page.getByRole('heading', { name: /Media library/ })).toBeVisible();
  await page.getByLabel('Upload media file').setInputFiles({
    name: fileName,
    mimeType: 'image/png',
    buffer: Buffer.from(ONE_PIXEL_PNG, 'base64'),
  });

  await expect(page.getByRole('status').getByText(`${fileName} was added to your media library.`)).toBeVisible({ timeout: 20_000 });
  const assetCard = page.locator('article').filter({ hasText: fileName });
  await expect(assetCard).toBeVisible();
  await expect(assetCard.locator('img')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search media files' }).fill(fileName);
  await expect(assetCard).toBeVisible();

  await page.goto('/instagram/compose');
  await page.getByRole('combobox', { name: 'Instagram account' }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Choose from library' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose media' });
  const pickerCard = picker.locator('article').filter({ hasText: fileName });
  await expect(pickerCard).toBeVisible();
  await pickerCard.getByRole('button', { name: 'Select file' }).click();
  await expect(picker).toBeHidden();
  await expect(page.locator(`img[alt="${fileName}"]`)).toBeVisible();
  const preview = page.getByRole('img', { name: 'Instagram post preview' });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.getByLabel('Caption').fill('A photo selected from the media library.');

  await page.getByRole('button', { name: 'Publish now' }).click();
  await expect(page).toHaveURL(/\/instagram\/publications\/[0-9a-f-]+$/, { timeout: 30_000 });
  await expect(page.locator('[data-status="PUBLISHED"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('A photo selected from the media library.')).toBeVisible();

  await page.goto('/media');
  await page.getByRole('searchbox', { name: 'Search media files' }).fill(fileName);
  const savedAsset = page.locator('article').filter({ hasText: fileName });
  await expect(savedAsset).toBeVisible();
  await savedAsset.getByRole('button', { name: `Delete ${fileName}` }).click();
  const deleteDialog = page.getByRole('dialog', { name: 'Delete this media file?' });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole('button', { name: 'Delete file' }).click();
  await expect(page.getByRole('status').getByText('Media file deleted.')).toBeVisible();
  await expect(savedAsset).toHaveCount(0);
});
