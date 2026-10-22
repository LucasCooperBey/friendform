import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { FormSchema, Question } from "../shared/form-schema";
import { TEMPLATES, type FormTemplate } from "../shared/templates";

const BASE = "http://127.0.0.1:4174";
const PASSWORD = "screenshots-password-not-secret";
const SESSION_SECRET = "screenshots-session-secret-not-secret-0000000000";
const OUT_DIR = path.resolve(process.cwd(), "docs/screenshots");

interface SeededForm {
  id: string;
  slug: string;
  title: string;
}

interface Person {
  name: string;
  email: string;
  party: number;
  dish: string;
  category: string;
}

const PEOPLE: Person[] = [
  { name: "Avery Example", email: "avery.example@example.com", party: 2, dish: "Example salad", category: "Side" },
  { name: "Blair Example", email: "blair.example@example.com", party: 1, dish: "Example rolls", category: "Main" },
  { name: "Casey Example", email: "casey.example@example.com", party: 4, dish: "Example cookies", category: "Dessert" },
];

const PROJECTS = [
  { name: "Avery Example", outcome: "An example outcome for Avery." },
  { name: "Blair Example", outcome: "An example outcome for Blair." },
  { name: "Casey Example", outcome: "An example outcome for Casey." },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function templateById(id: string): FormTemplate {
  const found = TEMPLATES.find((item) => item.id === id);
  if (!found) throw new Error(`missing template ${id}`);
  return found;
}

function withReachCondition(schema: FormSchema): FormSchema {
  const next = structuredClone(schema);
  for (const section of next.sections) {
    for (const question of section.questions) {
      if (question.questionId !== "reach") continue;
      const metadata: Question["metadata"] = {
        ...(question.metadata ?? {}),
        conditionalLogic: {
          enabled: true,
          questionId: "name",
          operator: "equals",
          value: "Avery Example",
        },
      };
      question.metadata = metadata;
    }
  }
  return next;
}

function readForm(value: unknown): SeededForm {
  if (!isRecord(value) || !isRecord(value.form)) throw new Error("form response was not readable");
  const form = value.form;
  if (typeof form.id !== "string" || typeof form.slug !== "string" || typeof form.title !== "string") {
    throw new Error("form response was not readable");
  }
  return { id: form.id, slug: form.slug, title: form.title };
}

function sessionValue(response: Response): string {
  const line = response.headers.getSetCookie().find((part) => part.startsWith("ff_session="));
  if (line === undefined) throw new Error("login did not set a session cookie");
  const value = (line.split(";")[0] ?? "").slice("ff_session=".length);
  if (value === "") throw new Error("login did not set a session cookie");
  return value;
}

async function requestJson(cookie: string, method: string, pathname: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = { Origin: BASE };
  if (cookie !== "") headers.Cookie = `ff_session=${cookie}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${pathname} returned ${response.status} ${text}`);
  if (text.trim() === "") return null;
  return parseJson(text);
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code ?? "null"}`));
    });
  });
}

function waitForExit(child: ChildProcess, ms: number): Promise<number | null | "timeout"> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function startServer(dataDir: string): { child: ChildProcess; output: Buffer[] } {
  const output: Buffer[] = [];
  const child = spawn("node", ["dist/server.mjs"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: "4174",
      DATA_DIR: dataDir,
      ADMIN_PASSWORD: PASSWORD,
      SESSION_SECRET,
      DATABASE_URL: "",
      AI_BASE_URL: "",
      AI_API_KEY: "",
      AI_MODEL: "",
      TEST_DATABASE_URL: "",
      TRUST_PROXY: "",
      PUBLIC_URL: "",
      WEBHOOK_SECRET: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    output.push(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output.push(chunk);
  });
  return { child, output };
}

async function waitForHealth(child: ChildProcess, output: Buffer[]): Promise<void> {
  const deadline = Date.now() + 30_000;
  let last = "no response";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited ${child.exitCode}\n${Buffer.concat(output).toString("utf8")}`);
    }
    try {
      const response = await fetch(`${BASE}/api/health`);
      const body = parseJson(await response.text());
      if (response.status === 200 && isRecord(body) && body.ok === true) return;
      last = `${response.status} ${JSON.stringify(body)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : "fetch failed";
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`health check timed out: ${last}\n${Buffer.concat(output).toString("utf8")}`);
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const code = await waitForExit(child, 5_000);
  if (code === "timeout") {
    child.kill("SIGKILL");
    await waitForExit(child, 2_000);
  }
}

async function signIn(): Promise<string> {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (response.status !== 204) throw new Error(`login returned ${response.status} ${await response.text()}`);
  return sessionValue(response);
}

async function createPublished(cookie: string, template: FormTemplate, schema: FormSchema): Promise<SeededForm> {
  const created = readForm(await requestJson(cookie, "POST", "/api/forms", {
    title: template.title,
    description: template.description,
    draftSchema: schema,
    settings: { theme: "light" },
  }));
  await requestJson(cookie, "POST", `/api/forms/${created.id}/publish`, {});
  return created;
}

async function submitPublic(slug: string, responses: Record<string, string | number>): Promise<void> {
  const response = await fetch(`${BASE}/api/public/forms/${slug}/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ responses }),
  });
  if (response.status !== 201) throw new Error(`submission returned ${response.status} ${await response.text()}`);
}

async function seed(cookie: string): Promise<{ potluck: SeededForm; intake: SeededForm }> {
  const potluckTemplate = templateById("potluck-sign-up");
  const intakeTemplate = templateById("project-intake");
  const potluck = await createPublished(cookie, potluckTemplate, potluckTemplate.schema);
  const intake = await createPublished(cookie, intakeTemplate, withReachCondition(intakeTemplate.schema));
  for (const person of PEOPLE) {
    await submitPublic(potluck.slug, {
      name: person.name,
      email: person.email,
      party_size: person.party,
      dish: person.dish,
      category: person.category,
    });
  }
  for (const project of PROJECTS) {
    await submitPublic(intake.slug, {
      name: project.name,
      outcome: project.outcome,
      keep_answers: "Yes",
    });
  }
  return { potluck, intake };
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(OUT_DIR, name), type: "png" });
}

async function chooseTheme(page: Page, name: "Light" | "Dark"): Promise<void> {
  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitem", { name }).click();
  const dark = name === "Dark";
  await page.waitForFunction((wantDark) => document.documentElement.classList.contains("dark") === wantDark, dark);
}

async function expandReach(page: Page): Promise<void> {
  const reach = page.getByRole("article", { name: "What is the best way to reach you?" });
  const edit = reach.getByRole("button", { name: "Edit What is the best way to reach you?" });
  if ((await edit.getAttribute("aria-expanded")) !== "true") await edit.click();
  const value = reach.getByRole("textbox", { name: "Comparison value" });
  await value.waitFor();
  await value.evaluate((element) => {
    const bottom = element.getBoundingClientRect().bottom + window.scrollY;
    window.scrollTo(0, Math.max(0, bottom - window.innerHeight + 16));
  });
}

async function openPublic(page: Page, slug: string, dark: boolean): Promise<void> {
  await page.goto(`${BASE}/f/${slug}`);
  await page.getByRole("heading", { name: "Potluck sign-up" }).waitFor();
  await page.waitForFunction((wantDark) => document.documentElement.classList.contains("dark") === wantDark, dark);
}

async function capture(browser: Browser, cookie: string, forms: { potluck: SeededForm; intake: SeededForm }): Promise<void> {
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  });
  await addSession(desktop, cookie);
  const page = await desktop.newPage();
  await page.goto(`${BASE}/`);
  await page.getByRole("heading", { name: "Your forms" }).waitFor();
  await chooseTheme(page, "Light");
  await page.getByRole("heading", { name: "Potluck sign-up" }).waitFor();
  await page.getByRole("heading", { name: "Project intake" }).waitFor();
  await shot(page, "forms.png");

  await page.goto(`${BASE}/forms/${forms.intake.id}/edit`);
  await page.getByRole("textbox", { name: "Form title" }).waitFor();
  await chooseTheme(page, "Light");
  await expandReach(page);
  await shot(page, "editor.png");

  await openPublic(page, forms.potluck.slug, false);
  await shot(page, "public.png");

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  });
  const phone = await mobile.newPage();
  await openPublic(phone, forms.potluck.slug, false);
  await shot(phone, "public-mobile.png");
  await mobile.close();

  await page.goto(`${BASE}/forms/${forms.potluck.id}/responses`);
  await page.getByRole("heading", { name: "Potluck sign-up" }).waitFor();
  await page.getByRole("table").waitFor();
  await page.getByRole("cell", { name: "Avery Example" }).waitFor();
  await shot(page, "responses.png");

  await page.goto(`${BASE}/forms/${forms.intake.id}/edit`);
  await page.getByRole("textbox", { name: "Form title" }).waitFor();
  await chooseTheme(page, "Dark");
  await expandReach(page);
  await shot(page, "editor-dark.png");

  await requestJson(cookie, "PATCH", `/api/forms/${forms.potluck.id}`, { settings: { theme: "dark" } });
  await openPublic(page, forms.potluck.slug, true);
  await shot(page, "public-dark.png");
  await desktop.close();
}

async function addSession(context: BrowserContext, cookie: string): Promise<void> {
  await context.addCookies([{
    name: "ff_session",
    value: cookie,
    url: BASE,
    httpOnly: true,
    sameSite: "Lax",
  }]);
}

async function main(): Promise<void> {
  if (PASSWORD.length < 12) throw new Error(`password length ${PASSWORD.length}`);
  if (SESSION_SECRET.length < 32) throw new Error(`session secret length ${SESSION_SECRET.length}`);
  await runCommand("bun", ["run", "build"]);
  mkdirSync(OUT_DIR, { recursive: true });
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "friendform-shots-"));
  const { child, output } = startServer(dataDir);
  let browser: Browser | undefined;
  try {
    await waitForHealth(child, output);
    const cookie = await signIn();
    const forms = await seed(cookie);
    browser = await chromium.launch();
    await capture(browser, cookie, forms);
  } finally {
    await browser?.close();
    await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : "screenshots failed";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
