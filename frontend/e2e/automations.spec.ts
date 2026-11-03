import { expect, test } from "@playwright/test";

test("creates, tests, reviews and manages an Instagram automation in MOCK", async ({
  page,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const ruleName = `Launch comment ${suffix}`;

  await page.goto("/register");
  await page
    .getByLabel("Organization name")
    .fill(`Automation Workspace ${suffix}`);
  await page
    .getByLabel("Email address")
    .fill(`automation-ui-${suffix}@example.com`);
  await page.getByLabel("Password").fill("Automation-ui-workspace-2026!");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/instagram/accounts");
  await page
    .getByRole("button", { name: "Connect your first account" })
    .click();
  const mockDialog = page.getByRole("dialog", {
    name: "Complete mock connection",
  });
  await expect(mockDialog).toBeVisible();
  const accountsResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/backend/organizations/") &&
      response.url().endsWith("/instagram/accounts") &&
      response.request().method() === "GET",
  );
  await page.getByRole("button", { name: "Simulate approval" }).click();
  const accountResponse = await accountsResponse;
  const accounts = (await accountResponse.json()) as Array<{
    id: string;
    provider: string;
    username: string;
  }>;
  const account = accounts[0];
  expect(account?.provider).toBe("MOCK");

  await page.goto("/automations");
  await expect(
    page.getByRole("heading", { name: "Automations", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create rule" }).click();
  await expect(
    page.getByRole("heading", { name: "Create automation" }),
  ).toBeVisible();
  await page.getByLabel("Rule name").fill(ruleName);
  await page
    .getByLabel("Automation Instagram account")
    .selectOption(account.id);
  await page.getByRole("button", { name: "Create rule" }).last().click();
  await expect(
    page
      .getByRole("alert")
      .getByText("Complete each condition or remove the blank row."),
  ).toBeVisible();

  await page.getByLabel("Condition value 1").fill("launch");
  await page.getByLabel("Action 1", { exact: true }).selectOption("REPLY_COMMENT");
  await page.getByLabel("Action message 1").fill("Thanks for your interest!");
  await page.getByRole("button", { name: "Create rule" }).last().click();
  const ruleCard = page
    .locator("article")
    .filter({ hasText: ruleName })
    .first();
  await expect(ruleCard.getByText("Active", { exact: true })).toBeVisible();
  await expect(ruleCard.getByText(/text contains “launch”/)).toBeVisible();

  await ruleCard.getByRole("button", { name: "Test rule" }).click();
  const testDialog = page.getByRole("dialog", { name: "Test rule" });
  await expect(testDialog.getByText(/MOCK test/)).toBeVisible();
  await testDialog.getByRole("button", { name: "Run test" }).click();
  await expect(testDialog.getByLabel("Test event text")).toHaveValue(
    "Test event: launch",
  );
  await expect(testDialog.getByLabel("Test comment ID")).not.toHaveValue(
    "mock-comment-test",
  );
  await expect(
    testDialog.getByTestId("execution-status").getByText("SUCCESS"),
  ).toBeVisible({ timeout: 20_000 });
  await testDialog.getByRole("button", { name: "Close test dialog" }).click();

  const history = page.getByRole("region", { name: "Execution history" });
  const runRow = history
    .locator("article")
    .filter({ hasText: ruleName })
    .first();
  await expect(
    runRow.getByTestId("execution-status").getByText("SUCCESS"),
  ).toBeVisible();
  await runRow.getByRole("button", { name: "View details" }).click();
  await expect(runRow.getByText("Reply to comment")).toBeVisible();

  await ruleCard.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Rule name").fill(`${ruleName} edited`);
  await page.getByRole("button", { name: "Save changes" }).click();
  const editedCard = page
    .locator("article")
    .filter({ hasText: `${ruleName} edited` })
    .first();
  await expect(editedCard.getByText("Active", { exact: true })).toBeVisible();

  await editedCard
    .getByRole("switch", { name: `Pause ${ruleName} edited` })
    .click();
  await expect(editedCard.getByText("Paused", { exact: true })).toBeVisible();
  await editedCard
    .getByRole("switch", { name: `Activate ${ruleName} edited` })
    .click();
  await expect(editedCard.getByText("Active", { exact: true })).toBeVisible();

  await editedCard
    .getByRole("button", { name: `Duplicate ${ruleName} edited` })
    .click();
  const copiedName = `${ruleName} edited copy`;
  const copiedCard = page
    .locator("article")
    .filter({ hasText: copiedName })
    .first();
  await expect(copiedCard.getByText("Paused", { exact: true })).toBeVisible();
  await copiedCard
    .getByRole("button", { name: `Delete ${copiedName}` })
    .click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Delete automation rule?",
  });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Delete rule" }).click();
  await expect(
    page.locator("article").filter({ hasText: copiedName }),
  ).toHaveCount(0);
});
