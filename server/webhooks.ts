import { createHmac } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { allQuestions, type FormSchema, type Responses, type WebhookConfig, type WebhookFormat } from "../shared/form-schema";
import type { DbHandle } from "./db/index";
import { forms, webhookDeliveries } from "./db/schema";
import { answerText } from "./forms-service";

export interface WebhookContext {
  form: { slug: string; title: string };
  submission: { id: string; createdAt: string; version: number | null };
  schema: FormSchema;
  responses: Responses;
  responsesUrl: string | null;
}
export interface DeliveryResult { ok: boolean; status: number | null; error: string | null }

function escapeSlack(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildPayload(format: WebhookFormat, ctx: WebhookContext): unknown {
  const answers = allQuestions(ctx.schema).filter((question) => Object.hasOwn(ctx.responses, question.questionId))
    .map((question) => ({
      questionId: question.questionId, prompt: question.prompt, type: question.type,
      value: ctx.responses[question.questionId],
    }));
  if (format === "slack") {
    return {
      text: `New response to ${escapeSlack(ctx.form.title.slice(0, 200))}`,
      blocks: [
        { type: "header", text: { type: "plain_text", text: `New response to ${ctx.form.title}`.slice(0, 150) } },
        ...answers.slice(0, 20).map((answer) => ({
          type: "section", text: {
            type: "mrkdwn",
            text: `*${escapeSlack(answer.prompt.slice(0, 200))}*\n${escapeSlack(answerText(answer.value).slice(0, 300))}`,
          },
        })),
      ],
    };
  }
  if (format === "discord") {
    const title = ctx.form.title.slice(0, 256);
    let length = title.length;
    const fields: Array<{ name: string; value: string }> = [];
    for (const answer of answers.slice(0, 25)) {
      const name = answer.prompt.slice(0, 256);
      const value = answerText(answer.value).slice(0, 1024) || "(empty)";
      if (length + name.length + value.length > 6000) break;
      fields.push({ name, value });
      length += name.length + value.length;
    }
    return {
      content: `New response to **${ctx.form.title}**`.slice(0, 2000),
      embeds: [{ title, fields, timestamp: ctx.submission.createdAt }],
      allowed_mentions: { parse: [] },
    };
  }
  return {
    event: "submission.created", form: { slug: ctx.form.slug, title: ctx.form.title },
    submission: { ...ctx.submission, answers }, responsesUrl: ctx.responsesUrl,
  };
}

export async function deliverWebhook(
  hook: WebhookConfig,
  ctx: WebhookContext,
  opts: { secret: string | null; fetchImpl: typeof fetch; timeoutMs?: number },
): Promise<DeliveryResult> {
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 5000);
  let onAbort: (() => void) | undefined;
  try {
    const body = JSON.stringify(buildPayload(hook.format, ctx));
    const headers: Record<string, string> = {
      "Content-Type": "application/json", "User-Agent": "Friendform-Webhooks/0.1",
      "X-Friendform-Event": "submission.created",
    };
    if (opts.secret) headers["X-Friendform-Signature"] = `sha256=${createHmac("sha256", opts.secret).update(body).digest("hex")}`;
    // The timeout also bounds injected fetch implementations that ignore AbortSignal.
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new DOMException("timeout", "AbortError"));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const response = await Promise.race([
      opts.fetchImpl(hook.url, { method: "POST", headers, body, redirect: "manual", signal }), aborted,
    ]);
    const ok = response.status >= 200 && response.status < 300;
    // No response content is read or retained in the delivery log.
    await response.body?.cancel();
    return { ok, status: response.status, error: ok ? null : `http_${response.status}` };
  } catch (error) {
    const timeout = signal.aborted || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"));
    return { ok: false, status: null, error: timeout ? "timeout" : "delivery_failed" };
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export async function recordDelivery(db: DbHandle, formId: string, hook: WebhookConfig, result: DeliveryResult): Promise<void> {
  await db.db.transaction(async (tx) => {
    // Serialize insert and pruning for this form so concurrent sends retain at most 100 rows.
    await tx.select({ id: forms.id }).from(forms).where(eq(forms.id, formId)).for("update");
    await tx.insert(webhookDeliveries).values({ formId, webhookId: hook.id, urlHost: new URL(hook.url).host, ...result });
    const oldRows = tx.select({ id: webhookDeliveries.id }).from(webhookDeliveries)
      .where(eq(webhookDeliveries.formId, formId))
      .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id)).offset(100);
    await tx.delete(webhookDeliveries).where(and(
      eq(webhookDeliveries.formId, formId), inArray(webhookDeliveries.id, oldRows),
    ));
  });
}
