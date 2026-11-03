import { expect, test, type Page } from "./fixtures";

const password = "Multi-account-e2e-2026!";

test("filters accounts, manages groups, and reports partial batch sync results", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await registerOwner(page, suffix);
  await page.goto("/instagram/accounts");

  await connectMock(page, `campaign-${suffix}`);
  await connectMock(page, `support-${suffix}`);
  await expect(page.locator('article[aria-label^="Account @mock_"]')).toHaveCount(2);

  await page.getByRole("button", { name: "New group" }).click();
  const createGroup = page.getByRole("dialog", { name: "Create account group" });
  await createGroup.getByLabel("Group name").fill("Campaigns");
  await createGroup.getByLabel(/Description/).fill("Accounts for campaign work");
  await createGroup.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("status").getByText("Group created.")).toBeVisible();

  await page.getByLabel("Select all accounts on this page").check();
  await page.getByLabel("Move selected accounts").selectOption({ label: "Campaigns" });
  await page.getByRole("button", { name: "Move selected", exact: true }).click();
  await expect(page.getByRole("status").getByText("Moved accounts: 2 succeeded, 0 failed.")).toBeVisible();
  await page.getByLabel("Filter by group").selectOption({ label: "Campaigns" });
  await expect(page.locator('article[aria-label^="Account @mock_"]')).toHaveCount(2);

  await page.getByLabel("Select all accounts on this page").check();
  await page.getByLabel("Tags to replace on selected accounts").fill("campaign, spring");
  await page.getByRole("button", { name: "Apply tags" }).click();
  await expect(page.getByRole("status").getByText("Updated tags: 2 succeeded, 0 failed.")).toBeVisible();
  await page.getByLabel("Filter by tag").fill("spring");
  await expect(page.locator('article[aria-label^="Account @mock_"]')).toHaveCount(2);
  await page.getByLabel("Filter by status").selectOption("CONNECTED");
  await expect(page.locator('article[aria-label^="Account @mock_"]')).toHaveCount(2);

  const firstAccount = page.locator('article[aria-label^="Account @mock_"]').first();
  await firstAccount.getByRole("button", { name: /^Disconnect account/ }).click();
  const disconnectDialog = page.getByRole("alertdialog", { name: "Disconnect Instagram account?" });
  await expect(disconnectDialog).toBeVisible();
  await disconnectDialog.getByRole("button", { name: "Disconnect account" }).click();
  await expect(page.getByRole("status").getByText("Instagram account disconnected.")).toBeVisible();

  await page.getByLabel("Filter by status").selectOption("");
  await expect(page.locator('article[aria-label^="Account @mock_"]')).toHaveCount(2);
  await page.getByLabel("Select all accounts on this page").check();
  await page.getByRole("button", { name: "Sync selected" }).click();
  await expect(page.getByRole("region", { name: "Batch operation results" })).toContainText("1 succeeded · 1 failed");
  await expect(page.getByRole("region", { name: "Batch operation results" }).getByText("Failed · account not ready")).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/access.?token|refresh.?token|encrypted.?token/i);
});

test("shows member access safely and surfaces a backend 403 for account management", async ({ page, request }) => {
  const backendUrl = process.env.BACKEND_API_URL ?? "http://127.0.0.1:3003";
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const memberEmail = `account-viewer-${suffix}@example.com`;
  const memberRegistration = await request.post(`${backendUrl}/api/auth/register`, {
    data: { email: memberEmail, password, organizationName: `Member home ${suffix}` },
    headers: { "X-Forwarded-For": "198.51.100.248" },
  });
  expect(memberRegistration.status()).toBe(201);

  const owner = await registerOwner(page, suffix);
  await page.goto("/instagram/accounts");
  await connectMock(page, `member-visible-${suffix}`);
  const setup = await page.evaluate(async ({ organizationId, email }) => {
    const add = await fetch(`/api/backend/organizations/${organizationId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const membership = await add.json() as { id: string };
    const accountResponse = await fetch(`/api/backend/organizations/${organizationId}/instagram/accounts?page=1&pageSize=20`);
    const accountPage = await accountResponse.json() as { items: Array<{ id: string }> };
    const accountId = accountPage.items[0].id;
    const grant = await fetch(`/api/backend/organizations/${organizationId}/instagram/accounts/${accountId}/access/${membership.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level: "VIEW" }),
    });
    return { addStatus: add.status, grantStatus: grant.status };
  }, { organizationId: owner.organizationId, email: memberEmail });
  expect(setup).toEqual({ addStatus: 201, grantStatus: 200 });

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  const loginStatus = await page.evaluate(async ({ email, password: pass, organizationId }) => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pass, organizationId }),
    });
    return response.status;
  }, { email: memberEmail, password, organizationId: owner.organizationId });
  expect(loginStatus).toBe(200);

  await page.goto("/instagram/accounts");
  await expect(page.locator('article[aria-label^="Account @mock_"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "New group" })).toHaveCount(0);
  await expect(page.locator('button[aria-label^="Disconnect account"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Edit details for/ })).toBeVisible();

  await page.getByRole("button", { name: /^Edit details for/ }).click();
  const editor = page.getByRole("dialog", { name: "Edit account details" });
  await editor.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "You do not have permission for this action." })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/access.?token|refresh.?token|encrypted.?token/i);
});

async function registerOwner(page: Page, suffix: string) {
  const email = `multi-account-owner-${suffix}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Organization name").fill(`Multi-account workspace ${suffix}`);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  const registration = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/register") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create workspace" }).click();
  const response = await registration;
  const body = await response.json() as { organizationId: string };
  await expect(page).toHaveURL(/\/dashboard$/);
  return body;
}

async function connectMock(page: Page, authorizationCode: string) {
  const connectButton = page.getByRole("button", { name: "Connect account" });
  await connectButton.click();
  const dialog = page.getByRole("dialog", { name: "Complete mock connection" });
  await expect(dialog.getByText("MOCK provider", { exact: true })).toBeVisible();
  await expect(dialog.getByText("No Instagram credentials are needed.")).toBeVisible();
  await dialog.getByLabel("Mock authorization code").fill(authorizationCode);
  await dialog.getByRole("button", { name: "Simulate approval" }).click();
  await expect(page.getByRole("status").getByText("Instagram account connected successfully.")).toBeVisible();
}
