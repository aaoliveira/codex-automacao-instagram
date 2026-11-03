import { expect, test, type Page } from "./fixtures";

const password = "Template-browser-e2e-2026!";

test("searches templates, validates variables, previews and applies a paused rule from MOCK", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  await registerOwner(page, suffix);
  await connectMock(page, `template-mock-${suffix}`);

  await page.goto("/automations/templates");
  await expect(page.getByRole("heading", { name: "Automation templates" })).toBeVisible();
  const systemSection = page.getByRole("region", { name: "SYSTEM templates" });
  await page.getByLabel("Search templates").fill("Capture a comment lead");
  await expect(systemSection.getByRole("article", { name: /Capture a comment lead/ })).toBeVisible();
  await page.getByLabel("Filter templates by category").selectOption("CUSTOMER_SUPPORT");
  await expect(systemSection.getByText("No templates match these filters")).toBeVisible();
  await page.getByLabel("Search templates").fill("");

  const acknowledgment = systemSection.getByRole("article", { name: /Comment acknowledgment/ });
  await expect(acknowledgment).toBeVisible();
  await acknowledgment.getByRole("button", { name: "Use template" }).click();
  const useDialog = page.getByRole("dialog", { name: "Use Comment acknowledgment" });
  await expect(useDialog.getByLabel("Template Instagram account")).toBeVisible();
  await expect(useDialog.getByRole("option").nth(1)).toBeAttached();
  await useDialog.getByLabel("Template Instagram account").selectOption({ index: 1 });
  await useDialog.getByLabel("Brand name").fill("Northwind Studio");
  await useDialog.getByRole("button", { name: "Validate values" }).click();
  await expect(useDialog.getByRole("status")).toContainText("Variables validated");
  await useDialog.getByRole("button", { name: "Preview rule" }).click();
  const preview = useDialog.getByRole("region", { name: "Generated rule preview" });
  await expect(preview).toContainText("Paused · requires activation");
  await expect(preview).toContainText("Thanks for reaching out, Northwind Studio!");
  await useDialog.getByRole("button", { name: "Apply as paused rule" }).click();

  await expect(page).toHaveURL(/\/automations(?:\?ruleId=)?/);
  await expect(page.getByRole("heading", { name: "Edit automation" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Paused · review this generated rule before activation")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Template applied. This rule is paused for review.");
});

test("rejects an invalid import and exposes only read permissions to a member", async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const backendUrl = process.env.BACKEND_API_URL ?? "http://127.0.0.1:3003";
  const clientAddress = `198.51.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`;
  const memberEmail = `template-member-${suffix}@example.com`;
  const memberRegistration = await request.post(`${backendUrl}/api/auth/register`, {
    data: { email: memberEmail, password, organizationName: `Member home ${suffix}` },
    headers: { "X-Forwarded-For": clientAddress },
  });
  expect(memberRegistration.status()).toBe(201);

  const owner = await registerOwner(page, suffix);
  await page.goto("/automations/templates");
  const invalidDocument = {
    name: "Broken template",
    schemaVersion: 44,
    category: "CUSTOMER_SUPPORT",
  };
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import JSON" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "invalid-template.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(invalidDocument)),
  });
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Invalid automation template export document");

  const setup = await page.evaluate(async ({ organizationId, email }) => {
    const member = await fetch(`/api/backend/organizations/${organizationId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return { status: member.status };
  }, { organizationId: owner.organizationId, email: memberEmail });
  expect(setup.status).toBe(201);

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

  await page.goto("/automations/templates");
  await expect(page.getByRole("heading", { name: "Automation templates" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create template", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "From a rule" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Duplicate template/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Import JSON" })).toBeDisabled();

  const denied = await page.evaluate(async (organizationId) => {
    const response = await fetch(`/api/backend/organizations/${organizationId}/automation-templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Member should not create",
        category: "NOTIFICATIONS",
        schemaVersion: 1,
        triggerType: "WEBHOOK_EVENT_RECEIVED",
        conditions: { match: "ALL", rules: [] },
        actions: [{ type: "REGISTER_EVENT" }],
        variables: [],
      }),
    });
    const templatesResponse = await fetch(`/api/backend/organizations/${organizationId}/automation-templates`);
    const templates = await templatesResponse.json() as Array<{ id: string; scope: string }>;
    const systemTemplate = templates.find((template) => template.scope === "SYSTEM");
    const applyResponse = systemTemplate ? await fetch(`/api/backend/organizations/${organizationId}/automation-templates/${systemTemplate.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instagramAccountId: "00000000-0000-4000-8000-000000000001", variables: {} }),
    }) : undefined;
    return { create: response.status, apply: applyResponse?.status };
  }, owner.organizationId);
  expect(denied).toEqual({ create: 403, apply: 403 });
});

test("creates a template from an existing rule, duplicates, archives and restores it", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const owner = await registerOwner(page, suffix);
  await connectMock(page, `rule-source-${suffix}`);

  const sourceRule = await page.evaluate(async (organizationId) => {
    const accountResponse = await fetch(`/api/backend/organizations/${organizationId}/instagram/accounts`);
    const accounts = await accountResponse.json() as Array<{ id: string }>;
    const response = await fetch(`/api/backend/organizations/${organizationId}/automation-rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instagramAccountId: accounts[0].id,
        name: "Welcome comment rule",
        active: false,
        triggerType: "COMMENT_RECEIVED",
        conditions: { match: "ALL", rules: [{ field: "text", operator: "CONTAINS", value: "hello" }] },
        actions: [{ type: "REGISTER_EVENT" }, { type: "REPLY_COMMENT", text: "Thanks for saying hello!" }],
      }),
    });
    return { status: response.status };
  }, owner.organizationId);
  expect(sourceRule.status).toBe(201);

  await page.goto("/automations/templates");
  await page.getByRole("button", { name: "From a rule" }).click();
  const editor = page.getByRole("dialog");
  await expect(editor.getByRole("option", { name: /Welcome comment rule/ })).toBeAttached();
  await editor.getByLabel("Template source rule").selectOption({ label: "Welcome comment rule · Comment received" });
  await editor.getByLabel("Template name").fill(`Welcome template ${suffix}`);
  await editor.getByRole("button", { name: "Create template" }).click();
  const createdCard = page.getByRole("article", { name: new RegExp(`Welcome template ${suffix}`) });
  await expect(createdCard).toBeVisible();
  await expect(createdCard).toContainText("Organization");
  await page.getByRole("button", { name: "Close dialog" }).click();

  await createdCard.getByRole("button", { name: `Duplicate template Welcome template ${suffix}` }).click();
  await expect(page.getByRole("status")).toContainText("Created organization copy");
  await expect(page.getByRole("heading", { name: `Welcome template ${suffix} (copy)` })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();

  const originalCard = page.getByRole("article", { name: new RegExp(`Welcome template ${suffix}`) }).first();
  await originalCard.getByRole("button", { name: `Archive template Welcome template ${suffix}` }).click();
  const confirm = page.getByRole("alertdialog", { name: "Archive automation template?" });
  await confirm.getByRole("button", { name: "Archive template" }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByLabel("Include archived templates").check();
  const archivedCard = page.getByRole("article", { name: new RegExp(`Welcome template ${suffix}`) }).first();
  await expect(archivedCard).toContainText("Archived");
  await archivedCard.getByRole("button", { name: `Restore template Welcome template ${suffix}` }).click();
  await expect(page.getByRole("status")).toContainText(`Restored “Welcome template ${suffix}”.`);
});

async function registerOwner(page: Page, suffix: string) {
  await page.goto("/register");
  await page.getByLabel("Organization name").fill(`Template workspace ${suffix}`);
  await page.getByLabel("Email address").fill(`template-owner-${suffix}@example.com`);
  await page.getByLabel("Password").fill(password);
  const registration = page.waitForResponse((response) => response.url().endsWith("/api/auth/register") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create workspace" }).click();
  const response = await registration;
  const body = await response.json() as { organizationId: string };
  await expect(page).toHaveURL(/\/dashboard$/);
  return body;
}

async function connectMock(page: Page, authorizationCode: string) {
  await page.goto("/instagram/accounts");
  await page.getByRole("button", { name: "Connect account" }).click();
  const dialog = page.getByRole("dialog", { name: "Complete mock connection" });
  await dialog.getByLabel("Mock authorization code").fill(authorizationCode);
  await dialog.getByRole("button", { name: "Simulate approval" }).click();
  await expect(page.getByRole("status").getByText("Instagram account connected successfully.")).toBeVisible();
}
