import { getConfig } from "./config";
import { getLocations } from "./projects";
import { getResources } from "./resources";
import { getDeployments } from "./deployments";
import { getServers } from "./servers";
import { demoData, isDemo } from "../demo";
import type { Dashboard } from "../schemas";
export async function getDashboard(): Promise<Dashboard> {
  if (isDemo()) return demoData;
  const config = await getConfig();
  if (!config)
    return {
      demo: false,
      connected: false,
      coolifyUrl: "",
      resources: [],
      deployments: [],
      servers: [],
      warnings: [],
    };
  const base = config.url.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  const warnings: string[] = [];
  const locations = getLocations().catch(() => {
    warnings.push("Resource links and environment names are unavailable.");
    return new Map();
  });
  const results = await Promise.allSettled([
    getResources("app", base, locations),
    getResources("database", base, locations),
    getResources("service", base, locations),
    getServers(),
  ]);
  for (const r of results)
    if (r.status === "rejected")
      warnings.push(
        r.reason instanceof Error
          ? r.reason.message
          : "A Coolify endpoint is unavailable.",
      );
  const apps = results[0],
    dbs = results[1],
    services = results[2],
    servers = results[3];
  const resources = [
    ...(apps?.status === "fulfilled" ? apps.value : []),
    ...(dbs?.status === "fulfilled" ? dbs.value : []),
    ...(services?.status === "fulfilled" ? services.value : []),
  ];
  let deployments: Dashboard["deployments"] = [];
  try {
    const history = await getDeployments(resources);
    deployments = history.deployments;
    warnings.push(...history.warnings);
  } catch (error) {
    warnings.push(
      error instanceof Error
        ? error.message
        : "Deployment history unavailable.",
    );
  }
  for (const resource of resources) {
    if (
      resource.kind === "app" &&
      deployments.some(
        (d) =>
          d.resourceId === resource.id &&
          (d.status === "deploying" || d.status === "queued"),
      )
    )
      resource.status = "deploying";
  }
  return {
    demo: false,
    connected: results.some((r) => r.status === "fulfilled"),
    coolifyUrl: base,
    resources,
    deployments,
    servers: servers?.status === "fulfilled" ? servers.value : [],
    warnings: [...new Set(warnings)],
  };
}
