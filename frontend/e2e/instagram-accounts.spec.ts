import { expect, test } from "@playwright/test";

test("connects, views, synchronizes, and disconnects a MOCK Instagram account", async ({
  page,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  await page.goto("/register");
  await page
    .getByLabel("Organization name")
    .fill(`Instagram Workspace ${suffix}`);
  await page
    .getByLabel("Email address")
    .fill(`instagram-${suffix}@example.com`);
  await page.getByLabel("Password").fill("Instagram-mock-workspace-2026!");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/instagram/accounts");
  await expect(
    page.getByRole("heading", { name: "Instagram accounts", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No Instagram accounts yet" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Connect your first account" })
    .click();

  const mockDialog = page.getByRole("dialog", {
    name: "Complete mock connection",
  });
  await expect(mockDialog.getByText("MOCK provider")).toBeVisible();
  await expect(
    mockDialog.getByText("No Instagram credentials are needed."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Simulate approval" }).click();

  await expect(
    page
      .getByRole("status")
      .getByText("Instagram account connected successfully."),
  ).toBeVisible();
  const accountCard = page.locator("article").filter({ hasText: "MOCK" });
  await expect(
    accountCard.getByText("Connected", { exact: true }),
  ).toBeVisible();
  await expect(accountCard.getByText(/^@mock_[a-f0-9]{8}$/)).toBeVisible();
  await expect(accountCard.getByText(/^Mock Creator /)).toBeVisible();

  await accountCard
    .getByRole("button", { name: /^Sync account @mock_/ })
    .click();
  await expect(
    page.getByRole("status").getByText("Instagram account synchronized."),
  ).toBeVisible();
  await expect(accountCard.getByText(/Last synced/)).toBeVisible();
  await expect(accountCard.getByText(/^@mock_[a-f0-9]{8}$/)).toBeVisible();

  await accountCard
    .getByRole("button", { name: /^Disconnect account/ })
    .click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Disconnect Instagram account?",
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Disconnect account" })
    .click();

  await expect(
    page.getByRole("status").getByText("Instagram account disconnected."),
  ).toBeVisible();
  await expect(
    accountCard.getByText("Disconnected", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("main")).not.toContainText(
    /access.?token|encrypted/i,
  );
});
