import { z } from "zod";
import { coolifyRequest } from "./client";
import type { Deployment, Resource } from "../schemas";
const raw = z.object({
  deployment_uuid: z.string(),
  application_id: z.union([z.string(), z.number()]).nullish(),
  application_name: z.string().nullish(),
  status: z.string(),
  commit: z.string().nullish(),
  commit_message: z.string().nullish(),
  created_at: z.string(),
  updated_at: z.string().nullish(),
  finished_at: z.string().nullish(),
  logs: z.string().nullish(),
});
function normalize(d: z.infer<typeof raw>, resource: Resource): Deployment {
  const end = d.finished_at;
  const duration = end
    ? Math.max(
        0,
        Math.round((Date.parse(end) - Date.parse(d.created_at)) / 1000),
      )
    : null;
  return {
    id: d.deployment_uuid,
    resourceId: resource.id,
    name: resource.name,
    status:
      d.status === "finished"
        ? "successful"
        : d.status === "failed" ||
            d.status === "cancelled-by-user" ||
            d.status === "cancelled"
          ? "failed"
          : d.status === "queued"
            ? "queued"
            : "deploying",
    branch: resource.branch,
    commit: (d.commit ?? "").slice(0, 7),
    message: d.commit_message ?? "",
    date: d.created_at,
    duration: duration === null ? "" : `${duration}s`,
    logs: "",
  };
}
const listSchema = z.union([
  z.array(raw),
  z.object({ deployments: z.array(raw) }),
]);
export async function getDeployments(
  resources: Resource[],
): Promise<{ deployments: Deployment[]; warnings: string[] }> {
  const apps = resources.filter((r) => r.kind === "app");
  const deployments: Deployment[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < apps.length; i += 5) {
    const batch = apps.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(async (resource) => {
        const response = listSchema.parse(
          await coolifyRequest(
            `/deployments/applications/${encodeURIComponent(resource.id)}?take=10`,
          ),
        );
        const list = Array.isArray(response) ? response : response.deployments;
        return list.map((d) => normalize(d, resource));
      }),
    );
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") deployments.push(...result.value);
      else
        warnings.push(
          `${batch[index]?.name ?? "Application"}: deployment history unavailable.`,
        );
    }
  }
  return {
    deployments: deployments
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
      .slice(0, 100),
    warnings,
  };
}
export async function getDeploymentLogs(id: string) {
  const data = raw.parse(
    await coolifyRequest(`/deployments/${encodeURIComponent(id)}`),
  );
  if (!data.logs) return "No deployment logs available.";
  try {
    const entries = z
      .array(z.object({ output: z.string(), timestamp: z.string().optional() }))
      .parse(JSON.parse(data.logs));
    return entries
      .map((entry) => `${entry.timestamp ?? ""} ${entry.output}`)
      .join("\n");
  } catch {
    return data.logs;
  }
}
