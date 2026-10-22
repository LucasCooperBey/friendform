import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

// source: a respondent fills a published form from a document, and the fake records that one chat request.

const PASSWORD = "e2e-password-not-secret";
const FILE_TEXT = "e2e document text for Avery Example";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function userMessage(body: unknown): string {
  if (!isRecord(body) || !Array.isArray(body.messages)) return "";
  for (const message of body.messages) {
    if (!isRecord(message) || message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
  }
  return "";
}

async function recordedRequests(): Promise<unknown[]> {
  const response = await fetch("http://127.0.0.1:4180/e2e/requests");
  if (!response.ok) throw new Error(`fake requests returned ${response.status}`);
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.requests)) throw new Error("fake requests were not readable");
  return payload.requests;
}

test("a respondent fills a form from a document", async ({ page }) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "friendform-e2e-"));
  const filePath = path.join(dir, "notes.txt");
  writeFileSync(filePath, FILE_TEXT);
  try {
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

    await page.getByRole("tab", { name: "Settings" }).click();
    const toggle = page.getByRole("switch", { name: "Let people fill this form from a document" });
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(toggle).toBeChecked();

    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const share = page.getByRole("link", { name: "Open" });
    await expect(share).toBeVisible();
    const href = await share.getAttribute("href");
    if (href === null || href === "") throw new Error("share link was empty");

    const cleared = await fetch("http://127.0.0.1:4180/e2e/requests", { method: "DELETE" });
    expect(cleared.status).toBe(204);

    const respondent = await page.context().newPage();
    await respondent.goto(href);
    await expect(respondent.getByRole("heading", { name: "Contact" })).toBeVisible();
    const chooserPromise = respondent.waitForEvent("filechooser");
    await respondent.getByRole("button", { name: "Fill from a document" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(filePath);

    await expect(
      respondent.getByRole("status").filter({ hasText: "Filled 4 answers. Check them before you submit." }),
    ).toBeVisible();
    await expect(respondent.getByLabel(/What is your name/)).toHaveValue("Avery Example");
    await expect(respondent.getByLabel(/What is your email address/)).toHaveValue("avery.example@example.com");
    await expect(respondent.getByLabel(/What is this regarding/)).toContainText("General question");
    await expect(respondent.getByLabel(/What would you like to say/)).toHaveValue("Example message from the document.");

    await respondent.getByRole("button", { name: "Submit" }).click();
    await expect(respondent.getByRole("heading", { name: "Thank you!" })).toBeVisible();
    await respondent.close();

    await page.goto(`/forms/${formId}/responses`);
    await expect(page.getByRole("table")).toContainText("Avery Example");

    const requests = await recordedRequests();
    const matching = requests.filter((request) => isRecord(request) && userMessage(request.body).includes(FILE_TEXT));
    expect(requests).toHaveLength(1);
    expect(matching).toHaveLength(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
