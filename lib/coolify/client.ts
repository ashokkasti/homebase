import { z } from "zod";
import { getConfig } from "./config";
import { connectionSchema } from "../schemas";
export async function coolifyRequest(
  path: string,
  method = "GET",
  override?: z.infer<typeof connectionSchema>,
  body?: unknown,
): Promise<unknown> {
  const config = override ?? (await getConfig());
  if (!config) throw new Error("Connect your Coolify server in Settings.");
  const base = config.url.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  let response: Response;
  try {
    response = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
  } catch {
    throw new Error(
      "Coolify is unavailable. Check the URL and network connection.",
    );
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new Error("Coolify rejected the API token. Check its permissions.");
    throw new Error(
      (await upstreamMessage(response)) ??
        (response.status === 404
          ? "Coolify could not find this resource or endpoint. Newer features need a recent Coolify version."
          : `Coolify request failed (${response.status}). Open Coolify for details.`),
    );
  }
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
// Coolify answers validation failures with { message, errors: { field: [..] } }.
// Only short plain-text messages are surfaced; upstream payloads never reach the browser.
async function upstreamMessage(response: Response) {
  try {
    const data = z
      .object({
        message: z.string().optional(),
        errors: z.record(z.string(), z.array(z.string())).optional(),
      })
      .parse(await response.json());
    const details = Object.values(data.errors ?? {}).flat();
    const message = [data.message, ...details]
      .filter((part): part is string => !!part)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return message ? `Coolify: ${message.slice(0, 300)}` : null;
  } catch {
    return null;
  }
}
export const rawResourceSchema = z.object({
  uuid: z.string(),
  id: z.union([z.number(), z.string()]).optional(),
  environment_id: z.union([z.string(), z.number()]).nullish(),
  name: z.string().nullish(),
  status: z.string().nullish(),
  fqdn: z.string().nullish(),
  description: z.string().nullish(),
  git_branch: z.string().nullish(),
  type: z.string().nullish(),
  project_uuid: z.string().nullish(),
  environment_uuid: z.string().nullish(),
  applications: z
    .array(
      z.object({
        uuid: z.string().nullish(),
        name: z.string(),
        status: z.string().nullish(),
        fqdn: z.string().nullish(),
      }),
    )
    .optional(),
  databases: z
    .array(
      z.object({
        uuid: z.string().nullish(),
        name: z.string(),
        status: z.string().nullish(),
        fqdn: z.string().nullish(),
      }),
    )
    .optional(),
});
export function normalizeStatus(
  status?: string | null,
): "running" | "deploying" | "stopped" | "failed" | "unknown" {
  const s = status?.toLowerCase() ?? "";
  if (s.includes("unhealthy") || s.includes("failed") || s.includes("error"))
    return "failed";
  if (
    s.includes("starting") ||
    s.includes("building") ||
    s.includes("progress") ||
    s.includes("deploy")
  )
    return "deploying";
  if (s.includes("running") || s === "healthy") return "running";
  if (s.includes("stopped") || s.includes("exited")) return "stopped";
  return "unknown";
}
export function safeUrl(value: string) {
  try {
    const url = new URL(value.split(",")[0]?.trim() ?? "");
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}
