import { expect, test } from "@playwright/test";

// source: an owner signs in, publishes the Contact template, collects one response, exports CSV, and a cross-origin close is refused.

const PASSWORD = "e2e-password-not-secret";
const ANSWER = "Smoke response Avery";

test("an owner builds, shares, collects and exports a response", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Owner password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your forms" })).toBeVisible();

  await page.getByRole("button", { name: "New form" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Contact\b/ }).click();
  await expect(page).toHaveURL(/\/forms\/[^/]+\/edit$/);
  const formId = /\/forms\/([^/]+)\/edit$/.exec(page.url())?.[1];
  if (formId === undefined) throw new Error("missing form id");

  const title = page.getByRole("textbox", { name: "Form title" });
  await expect(title).toHaveValue("Contact");
  await title.fill("Smoke test form");
  await expect(page.getByRole("status")).toHaveText("Saved");

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const share = page.getByRole("link", { name: "Open" });
  await expect(share).toBeVisible();
  const href = await share.getAttribute("href");
  if (href === null || href === "") throw new Error("share link was empty");

  const respondent = await page.context().newPage();
  await respondent.goto(href);
  await expect(respondent.getByRole("heading", { name: "Smoke test form" })).toBeVisible();
  await respondent.getByLabel(/What is your name/).fill(ANSWER);
  await respondent.getByLabel(/What is your email address/).fill("avery.example@example.com");
  await respondent.getByLabel(/What is this regarding/).click();
  await respondent.getByRole("option", { name: "General question" }).click();
  await respondent.getByLabel(/What would you like to say/).fill("Hello from the smoke test.");
  await respondent.getByRole("button", { name: "Submit" }).click();
  await expect(respondent.getByRole("heading", { name: "Thank you!" })).toBeVisible();

  await page.getByRole("link", { name: "Forms" }).click();
  await page.getByRole("button", { name: "Actions for Smoke test form" }).click();
  await page.getByRole("menuitem", { name: "Responses" }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/responses`));
  await expect(page.getByRole("region", { name: "Responses" })).toContainText("1");
  await expect(page.getByRole("table")).toContainText(ANSWER);
  await page.getByRole("row", { name: new RegExp(ANSWER) }).click();
  await expect(page.getByRole("dialog", { name: "Response" })).toContainText(ANSWER);

  const csv = await page.request.get(`/api/forms/${formId}/export.csv`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"] ?? "").toContain("text/csv");
  expect(await csv.text()).toContain(ANSWER);

  const blocked = await page.request.post(`/api/forms/${formId}/close`, {
    headers: { Origin: "https://evil.example" },
  });
  expect(blocked.status()).toBe(403);

  await respondent.reload();
  await expect(respondent.getByRole("heading", { name: "Smoke test form" })).toBeVisible();
  await expect(respondent.getByRole("button", { name: "Submit" })).toBeVisible();
  await respondent.close();
});
