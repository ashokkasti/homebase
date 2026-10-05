import { z } from "zod";
import {
  coolifyRequest,
  normalizeStatus,
  rawResourceSchema,
  safeUrl,
} from "./client";
import type { Location } from "./projects";
import type { Resource } from "../schemas";
export async function getResources(
  kind: Resource["kind"],
  baseUrl: string,
  locationsPromise: Promise<Map<string, Location>> = Promise.resolve(new Map()),
): Promise<Resource[]> {
  const route =
    kind === "app"
      ? "applications"
      : kind === "database"
        ? "databases"
        : "services";
  const [response, locations] = await Promise.all([
    coolifyRequest(`/${route}`),
    locationsPromise,
  ]);
  const records = z.array(rawResourceSchema).parse(response);
  const resources = records.map((r): Resource => {
    const location = locations.get(String(r.environment_id));
    const project = r.project_uuid ?? location?.project;
    const environment = r.environment_uuid ?? location?.environment;
    return {
      id: r.uuid,
      name: r.name ?? "Unnamed resource",
      kind,
      status: normalizeStatus(r.status),
      domain: safeUrl(r.fqdn ?? ""),
      description: r.description ?? r.type ?? "",
      engine: r.type ?? "",
      branch: r.git_branch ?? "",
      environment: location?.name ?? "",
      environmentId: environment ?? "",
      projectId: project ?? "",
      projectName: location?.projectName ?? "",
      coolifyUrl:
        project && environment
          ? `${baseUrl}/project/${encodeURIComponent(project)}/environment/${encodeURIComponent(environment)}/${kind === "app" ? "application" : kind}/${encodeURIComponent(r.uuid)}`
          : baseUrl,
      components: [
        ...(r.applications ?? []).map((component) => ({
          id: component.uuid ?? undefined,
          kind: "application" as const,
          name: component.name,
          domain: safeUrl(component.fqdn ?? "") || undefined,
          status: normalizeStatus(component.status),
        })),
        ...(r.databases ?? []).map((component) => ({
          id: component.uuid ?? undefined,
          kind: "database" as const,
          name: component.name,
          domain: safeUrl(component.fqdn ?? "") || undefined,
          status: normalizeStatus(component.status),
        })),
      ],
    };
  });
  if (kind === "service") {
    for (let i = 0; i < resources.length; i += 5) {
      await Promise.all(
        resources.slice(i, i + 5).map(async (resource) => {
          if (
            resource.components.length > 0 &&
            resource.components.every(
              (component) => component.id && component.kind,
            )
          )
            return;
          try {
            const componentSchema = z.array(
              z.object({
                uuid: z.string().nullish(),
                name: z.string(),
                status: z.string().nullish(),
                fqdn: z.string().nullish(),
              }),
            );
            const [apps, databases] = await Promise.all([
              coolifyRequest(
                `/services/${encodeURIComponent(resource.id)}/applications`,
              ),
              coolifyRequest(
                `/services/${encodeURIComponent(resource.id)}/databases`,
              ),
            ]);
            const applications = componentSchema.parse(apps);
            const dbs = componentSchema.parse(databases);
            const components = [...applications, ...dbs];
            resource.components = [
              ...applications.map((c) => ({
                id: c.uuid ?? undefined,
                kind: "application" as const,
                name: c.name,
                domain: safeUrl(c.fqdn ?? "") || undefined,
                status: normalizeStatus(c.status),
              })),
              ...dbs.map((c) => ({
                id: c.uuid ?? undefined,
                kind: "database" as const,
                name: c.name,
                domain: safeUrl(c.fqdn ?? "") || undefined,
                status: normalizeStatus(c.status),
              })),
            ];
            resource.domain =
              components.map((c) => safeUrl(c.fqdn ?? "")).find(Boolean) ??
              resource.domain;
          } catch {
            resource.components = [];
          }
        }),
      );
    }
  }
  return resources;
}
export async function resourceAction(
  kind: Resource["kind"],
  id: string,
  action: "deploy" | "force-deploy" | "start" | "restart" | "stop" | "delete",
  options: { deleteVolumes?: boolean } = {},
): Promise<{ deploymentId?: string }> {
  const encoded = encodeURIComponent(id);
  const route =
    kind === "app"
      ? "applications"
      : kind === "database"
        ? "databases"
        : "services";
  if (action === "deploy" || action === "force-deploy") {
    if (kind === "database")
      throw new Error("Databases are started, not deployed.");
    const result = z
      .object({
        deployments: z
          .array(z.object({ deployment_uuid: z.string().nullish() }))
          .optional(),
      })
      .catch({})
      .parse(
        await deployRequest(
          `/deploy?uuid=${encoded}${action === "force-deploy" ? "&force=true" : ""}`,
        ),
      );
    return {
      deploymentId: result.deployments?.[0]?.deployment_uuid ?? undefined,
    };
  }
  if (action === "delete") {
    const volumes = options.deleteVolumes ? "true" : "false";
    await coolifyRequest(
      `/${route}/${encoded}?delete_configurations=true&delete_volumes=${volumes}&docker_cleanup=true&delete_connected_networks=true`,
      "DELETE",
    );
    return {};
  }
  await coolifyRequest(`/${route}/${encoded}/${action}`, "POST");
  return {};
}

export async function serviceComponentAction(
  serviceId: string,
  componentId: string,
  kind: "application" | "database",
  action: "start" | "restart" | "stop",
) {
  const route = kind === "application" ? "applications" : "databases";
  return coolifyRequest(
    `/services/${encodeURIComponent(serviceId)}/${route}/${encodeURIComponent(componentId)}/${action}`,
    "POST",
  );
}

// Current Coolify only accepts POST /deploy; releases before that change only
// accept GET and answer POST with 405.
async function deployRequest(path: string) {
  try {
    return await coolifyRequest(path, "POST");
  } catch (error) {
    if (error instanceof Error && error.message.includes("(405)"))
      return coolifyRequest(path, "GET");
    throw error;
  }
}
