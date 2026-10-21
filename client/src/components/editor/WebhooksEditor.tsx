import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WebhookConfig, WebhookFormat } from "@shared/form-schema";
import { api, errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { queryClient } from "@/lib/session";
import { isRecord } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const WEBHOOK_LIMIT = 10;

const FORMAT_LABEL: Record<WebhookFormat, string> = {
  json: "JSON",
  slack: "Slack",
  discord: "Discord",
};

interface Delivery {
  id: string;
  webhookId: string;
  urlHost: string;
  status: number | null;
  ok: boolean;
  error: string | null;
  createdAt: string;
}

function isFormat(value: string): value is WebhookFormat {
  return value === "json" || value === "slack" || value === "discord";
}

function parseDeliveries(value: unknown): Delivery[] {
  if (!isRecord(value) || !Array.isArray(value.deliveries)) throw new Error("The deliveries were not readable.");
  return value.deliveries.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.webhookId !== "string" ||
      typeof item.urlHost !== "string" ||
      !(item.status === null || typeof item.status === "number") ||
      typeof item.ok !== "boolean" ||
      !(item.error === null || typeof item.error === "string") ||
      typeof item.createdAt !== "string"
    ) {
      throw new Error("The deliveries were not readable.");
    }
    return {
      id: item.id,
      webhookId: item.webhookId,
      urlHost: item.urlHost,
      status: item.status,
      ok: item.ok,
      error: item.error,
      createdAt: item.createdAt,
    };
  });
}

function readTest(value: unknown): { status: number | null; error: string | null } {
  if (!isRecord(value)) throw new Error("The test result was not readable.");
  const status = value.status === null || typeof value.status === "number" ? value.status : undefined;
  const error = value.error === null || typeof value.error === "string" ? value.error : undefined;
  if (status === undefined || error === undefined) throw new Error("The test result was not readable.");
  return { status, error };
}

export function WebhooksEditor({
  formId,
  webhooks,
  onChange,
}: {
  formId: string;
  webhooks: WebhookConfig[];
  onChange: (webhooks: WebhookConfig[]) => void;
}) {
  const [testing, setTesting] = useState<string | null>(null);
  const deliveries = useQuery({
    queryKey: ["form", formId, "deliveries"],
    queryFn: async ({ signal }) =>
      parseDeliveries(await api<unknown>(`/api/forms/${encodeURIComponent(formId)}/webhooks/deliveries`, { signal })),
  });

  function updateHook(id: string, patch: Partial<WebhookConfig>) {
    onChange(webhooks.map((hook) => (hook.id === id ? { ...hook, ...patch } : hook)));
  }

  async function sendTest(webhookId: string) {
    setTesting(webhookId);
    try {
      const result = readTest(
        await api<unknown>(`/api/forms/${encodeURIComponent(formId)}/webhooks/${encodeURIComponent(webhookId)}/test`, {
          method: "POST",
        }),
      );
      if (typeof result.status === "number") toast({ title: `Test sent: ${result.status}` });
      else toast({ title: result.error ?? "The test could not be sent." });
      await queryClient.invalidateQueries({ queryKey: ["form", formId, "deliveries"] });
    } catch (error) {
      toast({ title: errorMessage(error) });
    } finally {
      setTesting(null);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Webhooks</h2>
      <ul className="space-y-4">
        {webhooks.map((hook, index) => {
          const position = index + 1;
          return (
            <li key={hook.id} className="space-y-3 rounded-lg border p-4">
              <div className="space-y-2">
                <Label htmlFor={`webhook-url-${hook.id}`}>Webhook URL {position}</Label>
                <Input
                  id={`webhook-url-${hook.id}`}
                  value={hook.url}
                  maxLength={2000}
                  onChange={(event) => updateHook(hook.id, { url: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Format</Label>
                <Select
                  value={hook.format}
                  onValueChange={(value) => {
                    if (isFormat(value)) updateHook(hook.id, { format: value });
                  }}
                >
                  <SelectTrigger aria-label={`Format ${position}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FORMAT_LABEL) as WebhookFormat[]).map((format) => (
                      <SelectItem key={format} value={format}>
                        {FORMAT_LABEL[format]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={`webhook-enabled-${hook.id}`}>Enabled</Label>
                <Switch
                  id={`webhook-enabled-${hook.id}`}
                  checked={hook.enabled}
                  onCheckedChange={(checked) => updateHook(hook.id, { enabled: checked === true })}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={testing === hook.id} onClick={() => void sendTest(hook.id)}>
                  Send test
                </Button>
                <Button variant="outline" onClick={() => onChange(webhooks.filter((item) => item.id !== hook.id))}>
                  Remove webhook {position}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <Button
        variant="outline"
        disabled={webhooks.length >= WEBHOOK_LIMIT}
        onClick={() =>
          onChange([...webhooks, { id: crypto.randomUUID(), url: "", format: "json", enabled: true }])
        }
      >
        Add webhook
      </Button>
      <div className="space-y-2">
        <h3 className="font-medium">Recent deliveries</h3>
        {deliveries.isError ? <p className="text-sm text-destructive">{errorMessage(deliveries.error)}</p> : null}
        {deliveries.data && deliveries.data.length === 0 ? <p className="text-sm text-muted-foreground">No deliveries yet.</p> : null}
        {deliveries.data && deliveries.data.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {deliveries.data.map((delivery) => (
              <li key={delivery.id} className="flex flex-wrap gap-x-3 gap-y-1">
                <span>{delivery.urlHost}</span>
                <span>{delivery.status ?? delivery.error ?? "No status"}</span>
                <span className="text-muted-foreground">{relativeTime(delivery.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
