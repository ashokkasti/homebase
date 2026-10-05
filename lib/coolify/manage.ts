import { z } from "zod";
import { coolifyRequest, normalizeStatus } from "./client";
import { editableKeys } from "../config-fields";
import type {
  CreateInput,
  DeploymentDetail,
  EnvVar,
  Kind,
  LogLine,
  Meta,
  ResourceConfig,
  ServerDetail,
  Storage,
  Task,
} from "../schemas";
import {
  envInputSchema,
  projectInputSchema,
  storageInputSchema,
  taskInputSchema,
} from "../schemas";

type Rec = Record<string, unknown>;
function rec(value: unknown): Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : {};
}
function list(value: unknown): Rec[] {
  return Array.isArray(value) ? value.map(rec) : [];
}
function str(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}
function bool(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}
export function route(kind: Kind) {
  return kind === "app"
    ? "applications"
    : kind === "database"
      ? "databases"
      : "services";
}
function base(kind: Kind, id: string) {
  return `/${route(kind)}/${encodeURIComponent(id)}`;
}
const b64 = (value: string) => Buffer.from(value, "utf8").toString("base64");
function compact(body: Rec) {
  return Object.fromEntries(
    Object.entries(body).filter(
      ([, value]) => value !== "" && value !== undefined && value !== null,
    ),
  );
}

export async function getResourceName(kind: Kind, id: string) {
  return str(rec(await coolifyRequest(base(kind, id))).name);
}

// ───────────── Meta ─────────────
export async function getMeta(): Promise<Meta> {
  const [projects, servers, githubApps, version] = await Promise.all([
    coolifyRequest("/projects").then(list),
    coolifyRequest("/servers").then(list),
    coolifyRequest("/github-apps")
      .then(list)
      .catch(() => []),
    coolifyRequest("/version").catch(() => ""),
  ]);
  const withEnvironments = await Promise.all(
    projects.map(async (project) => {
      const id = str(project.uuid);
      const environments = await coolifyRequest(
        `/projects/${encodeURIComponent(id)}/environments`,
      )
        .then(list)
        .catch(() => []);
      return {
        id,
        name: str(project.name) || "Untitled project",
        description: str(project.description),
        environments: environments.map((e) => ({
          id: str(e.uuid),
          name: str(e.name),
        })),
      };
    }),
  );
  return {
    version: typeof version === "string" ? version.slice(0, 40) : "",
    projects: withEnvironments,
    servers: servers.map((s) => ({
      id: str(s.uuid),
      name: str(s.name),
      ip: str(s.ip),
      online:
        typeof rec(s.settings).is_reachable === "boolean"
          ? (rec(s.settings).is_reachable as boolean)
          : null,
    })),
    githubApps: githubApps
      .filter((app) => !bool(app.is_public))
      .map((app) => ({ id: str(app.uuid), name: str(app.name) })),
  };
}

// ───────────── Configuration ─────────────
export async function getConfig(
  kind: Kind,
  id: string,
): Promise<ResourceConfig> {
  const raw = rec(await coolifyRequest(base(kind, id)));
  const settings = rec(raw.settings);
  const fields: ResourceConfig["fields"] = {};
  for (const [key, def] of editableKeys(kind)) {
    const value = raw[def.readFrom ?? key] ?? settings[key];
    fields[key] =
      def.type === "bool"
        ? bool(value)
        : def.type === "number"
          ? value === null || value === undefined || value === ""
            ? null
            : Number(value)
          : str(value);
  }
  const info: Record<string, string> = {};
  const add = (label: string, value: unknown) => {
    const text = str(value);
    if (text) info[label] = text;
  };
  add("Status", raw.status);
  if (kind === "app") {
    add("Build pack", raw.build_pack);
    add("Commit", raw.git_commit_sha);
    add("Repository URL", raw.git_full_url);
  }
  if (kind === "database") {
    add("Engine", raw.database_type ?? raw.type);
    add("Internal URL", raw.internal_db_url);
    add("Public URL", raw.external_db_url);
  }
  if (kind === "service") add("Template", raw.service_type);
  add("Created", raw.created_at);
  return { kind, fields, info };
}
export async function updateConfig(
  kind: Kind,
  id: string,
  input: ResourceConfig["fields"],
) {
  const allowed = editableKeys(kind);
  const body: Rec = {};
  for (const [key, value] of Object.entries(input)) {
    const def = allowed.get(key);
    if (!def) throw new Error(`Field ${key} cannot be changed here.`);
    if (def.type === "bool") body[key] = value === true;
    else if (def.type === "number")
      body[key] = value === null || value === "" ? null : Number(value);
    else body[key] = value === null ? "" : String(value);
    if (key === "docker_compose_raw") body[key] = b64(String(value ?? ""));
  }
  if (Object.keys(body).length === 0) return;
  await coolifyRequest(base(kind, id), "PATCH", undefined, body);
}

// ───────────── Environment variables ─────────────
export async function listEnvs(kind: Kind, id: string): Promise<EnvVar[]> {
  return list(await coolifyRequest(`${base(kind, id)}/envs`)).map((e) => ({
    id: str(e.uuid) || str(e.id),
    key: str(e.key),
    value: str(e.value),
    isPreview: bool(e.is_preview),
    isLiteral: bool(e.is_literal),
    isMultiline: bool(e.is_multiline),
    isShownOnce: bool(e.is_shown_once),
  }));
}
export async function mutateEnv(
  kind: Kind,
  id: string,
  input: z.infer<typeof envInputSchema>,
) {
  const path = `${base(kind, id)}/envs`;
  if (input.op === "delete")
    return coolifyRequest(`${path}/${encodeURIComponent(input.id)}`, "DELETE");
  if (input.op === "bulk")
    return coolifyRequest(`${path}/bulk`, "PATCH", undefined, {
      data: input.entries.map((e) => ({ key: e.key, value: e.value })),
    });
  return coolifyRequest(
    path,
    input.op === "create" ? "POST" : "PATCH",
    undefined,
    {
      key: input.key,
      value: input.value,
      is_preview: input.isPreview,
      is_literal: input.isLiteral,
      is_multiline: input.isMultiline,
    },
  );
}

// ───────────── Storage ─────────────
export async function listStorages(kind: Kind, id: string): Promise<Storage[]> {
  const raw = rec(await coolifyRequest(`${base(kind, id)}/storages`));
  return [
    ...list(raw.persistent_storages).map((s): Storage => ({
      id: str(s.uuid) || str(s.id),
      type: "persistent",
      name: str(s.name),
      mountPath: str(s.mount_path),
      hostPath: str(s.host_path),
      content: "",
      readOnly: bool(s.is_readonly),
    })),
    ...list(raw.file_storages).map((s): Storage => ({
      id: str(s.uuid) || str(s.id),
      type: "file",
      name: str(s.fs_path).split("/").pop() ?? "",
      mountPath: str(s.mount_path),
      hostPath: str(s.fs_path),
      content: bool(s.is_directory) ? "" : str(s.content),
      readOnly: bool(s.is_readonly),
    })),
  ];
}
export async function mutateStorage(
  kind: Kind,
  id: string,
  input: z.infer<typeof storageInputSchema>,
) {
  const path = `${base(kind, id)}/storages`;
  if (input.op === "delete")
    return coolifyRequest(`${path}/${encodeURIComponent(input.id)}`, "DELETE");
  return coolifyRequest(
    path,
    "POST",
    undefined,
    compact({
      type: input.type,
      name: input.type === "persistent" ? input.name : undefined,
      mount_path: input.mountPath,
      content: input.type === "file" ? input.content : undefined,
    }),
  );
}

// ───────────── Scheduled tasks ─────────────
export async function listTasks(kind: Kind, id: string): Promise<Task[]> {
  if (kind === "database") return [];
  const path = `${base(kind, id)}/scheduled-tasks`;
  const tasks = list(await coolifyRequest(path));
  return Promise.all(
    tasks.map(async (t) => {
      const taskId = str(t.uuid);
      const executions = await coolifyRequest(
        `${path}/${encodeURIComponent(taskId)}/executions`,
      )
        .then(list)
        .catch(() => []);
      return {
        id: taskId,
        name: str(t.name),
        command: str(t.command),
        frequency: str(t.frequency),
        container: str(t.container),
        timeout:
          t.timeout === null || t.timeout === undefined
            ? null
            : Number(t.timeout),
        enabled: bool(t.enabled),
        executions: executions.slice(0, 5).map((e) => ({
          id: str(e.uuid),
          status: str(e.status),
          message: str(e.message).slice(0, 2000),
          date: str(e.started_at) || str(e.created_at),
          duration: str(e.duration),
        })),
      };
    }),
  );
}
export async function mutateTask(
  kind: Kind,
  id: string,
  input: z.infer<typeof taskInputSchema>,
) {
  if (kind === "database")
    throw new Error("Scheduled tasks are available for apps and services.");
  const path = `${base(kind, id)}/scheduled-tasks`;
  if ("command" in input) {
    const body = compact({
      name: input.name,
      command: input.command,
      frequency: input.frequency,
      container: input.container,
      timeout: input.timeout,
      enabled: input.enabled,
    });
    if (input.op === "create")
      return coolifyRequest(path, "POST", undefined, body);
    if (!input.id) throw new Error("Task ID is required.");
    return coolifyRequest(
      `${path}/${encodeURIComponent(input.id)}`,
      "PATCH",
      undefined,
      body,
    );
  }
  const task = `${path}/${encodeURIComponent(input.id)}`;
  if (input.op === "delete") return coolifyRequest(task, "DELETE");
  if (input.op === "run") return coolifyRequest(`${task}/execute`, "POST");
  return coolifyRequest(task, "PATCH", undefined, {
    enabled: input.op === "enable",
  });
}

// ───────────── Deployments ─────────────
export function deploymentStatus(status: string): DeploymentDetail["status"] {
  return status === "finished"
    ? "successful"
    : ["failed", "cancelled-by-user", "cancelled"].includes(status)
      ? "failed"
      : status === "queued"
        ? "queued"
        : "deploying";
}
export function parseLogLines(logs: string): LogLine[] {
  if (!logs) return [];
  try {
    const entries = list(JSON.parse(logs));
    return entries
      .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
      .flatMap((entry) =>
        str(entry.output)
          .split("\n")
          .map((text) => ({
            time: str(entry.timestamp),
            text,
            stream:
              entry.type === "stderr"
                ? ("stderr" as const)
                : ("stdout" as const),
            hidden: bool(entry.hidden),
            command: str(entry.command).slice(0, 500),
          })),
      );
  } catch {
    return logs.split("\n").map((text) => ({
      time: "",
      text,
      stream: "stdout" as const,
      hidden: false,
      command: "",
    }));
  }
}
export async function getDeploymentDetail(
  id: string,
): Promise<DeploymentDetail> {
  const d = rec(await coolifyRequest(`/deployments/${encodeURIComponent(id)}`));
  const rawStatus = str(d.status);
  return {
    id: str(d.deployment_uuid) || id,
    status: deploymentStatus(rawStatus),
    rawStatus,
    applicationName: str(d.application_name),
    serverName: str(d.server_name),
    commit: str(d.commit),
    message: str(d.commit_message),
    createdAt: str(d.created_at),
    finishedAt: [
      "finished",
      "failed",
      "cancelled-by-user",
      "cancelled",
    ].includes(rawStatus)
      ? str(d.finished_at) || str(d.updated_at)
      : "",
    trigger: bool(d.rollback)
      ? "rollback"
      : bool(d.is_webhook)
        ? "webhook"
        : bool(d.is_api)
          ? "api"
          : "manual",
    forceRebuild: bool(d.force_rebuild),
    url: str(d.deployment_url),
    lines: parseLogLines(str(d.logs)),
  };
}
export async function latestDeploymentId(appId: string) {
  const raw = await coolifyRequest(
    `/deployments/applications/${encodeURIComponent(appId)}?take=1`,
  );
  const items = Array.isArray(raw) ? list(raw) : list(rec(raw).deployments);
  return str(items[0]?.deployment_uuid) || undefined;
}
export async function cancelDeployment(id: string) {
  return coolifyRequest(
    `/deployments/${encodeURIComponent(id)}/cancel`,
    "POST",
  );
}
export async function getRollbackImages(id: string) {
  const raw = rec(
    await coolifyRequest(
      `/applications/${encodeURIComponent(id)}/rollback-images`,
    ),
  );
  return {
    current: str(raw.current),
    images: list(raw.images).map((image) => ({
      tag: str(image.tag),
      date: str(image.created_at),
      current: bool(image.is_current),
    })),
  };
}
export async function rollback(id: string, tag: string) {
  return coolifyRequest(
    `/applications/${encodeURIComponent(id)}/rollback`,
    "POST",
    undefined,
    { commit: tag },
  );
}

// ───────────── Create ─────────────
export async function createResource(input: CreateInput) {
  const location = {
    project_uuid: input.projectId,
    environment_uuid: input.environmentId,
    environment_name: input.environmentName,
    server_uuid: input.serverId,
    name: input.name,
    description: input.description,
    instant_deploy: input.instantDeploy,
  };
  let path: string;
  let body: Rec;
  let kind: Kind = "app";
  switch (input.type) {
    case "app-git":
      path = input.githubAppId
        ? "/applications/private-github-app"
        : "/applications/public";
      body = {
        ...location,
        github_app_uuid: input.githubAppId,
        git_repository: input.gitRepository,
        git_branch: input.gitBranch,
        build_pack: input.buildPack,
        base_directory: input.baseDirectory,
        ports_exposes: input.portsExposes,
        domains: input.domains,
      };
      break;
    case "app-image":
      path = "/applications/dockerimage";
      body = {
        ...location,
        docker_registry_image_name: input.image,
        docker_registry_image_tag: input.tag,
        ports_exposes: input.portsExposes,
        domains: input.domains,
      };
      break;
    case "app-dockerfile":
      path = "/applications/dockerfile";
      body = {
        ...location,
        dockerfile: b64(input.dockerfile),
        ports_exposes: input.portsExposes,
        domains: input.domains,
      };
      break;
    case "database":
      kind = "database";
      path = `/databases/${input.engine}`;
      body = {
        ...location,
        image: input.image,
        is_public: input.isPublic,
        public_port: input.isPublic ? input.publicPort : undefined,
      };
      break;
    case "service":
      kind = "service";
      if (!input.serviceType && !input.compose?.trim())
        throw new Error("Choose a one-click service or paste a compose file.");
      path = "/services";
      body = {
        ...location,
        type: input.compose?.trim() ? undefined : input.serviceType,
        docker_compose_raw: input.compose?.trim()
          ? b64(input.compose)
          : undefined,
      };
      break;
  }
  const result = rec(
    await coolifyRequest(path, "POST", undefined, compact(body)),
  );
  const id = str(result.uuid);
  if (!id) throw new Error("Coolify did not return the new resource ID.");
  return { id, kind };
}

// ───────────── Projects ─────────────
export async function mutateProject(input: z.infer<typeof projectInputSchema>) {
  if (input.op === "create")
    return coolifyRequest(
      "/projects",
      "POST",
      undefined,
      compact({
        name: input.name,
        description: input.description,
      }),
    );
  const project = `/projects/${encodeURIComponent(input.projectId)}`;
  if (input.op === "create-environment")
    return coolifyRequest(`${project}/environments`, "POST", undefined, {
      name: input.name,
    });
  const current = rec(await coolifyRequest(project));
  if (input.op === "delete") {
    if (input.confirmation !== str(current.name))
      throw new Error("Type the project name to confirm.");
    return coolifyRequest(project, "DELETE");
  }
  if (input.confirmation !== input.environment)
    throw new Error("Type the environment name to confirm.");
  return coolifyRequest(
    `${project}/environments/${encodeURIComponent(input.environment)}`,
    "DELETE",
  );
}

// ───────────── Servers ─────────────
const serverSettingKeys: [string, string][] = [
  ["server_role", "Role"],
  ["docker_version", "Docker"],
  ["compose_version", "Compose"],
  ["wildcard_domain", "Wildcard domain"],
  ["concurrent_builds", "Concurrent builds"],
  ["deployment_queue_limit", "Queue limit"],
  ["is_build_server", "Build server"],
  ["is_metrics_enabled", "Metrics"],
  ["is_cloudflare_tunnel", "Cloudflare tunnel"],
  ["docker_cleanup_frequency", "Cleanup schedule"],
  ["docker_cleanup_threshold", "Cleanup threshold %"],
];
export async function getServerDetail(id: string): Promise<ServerDetail> {
  const path = `/servers/${encodeURIComponent(id)}`;
  const [server, resources, domains] = await Promise.all([
    coolifyRequest(path).then(rec),
    coolifyRequest(`${path}/resources`)
      .then(list)
      .catch(() => []),
    coolifyRequest(`${path}/domains`)
      .then(list)
      .catch(() => []),
  ]);
  const settings = rec(server.settings);
  const proxy = rec(server.proxy);
  return {
    id: str(server.uuid) || id,
    name: str(server.name),
    description: str(server.description),
    ip: str(server.ip),
    port: str(server.port),
    user: str(server.user),
    proxy: str(server.proxy_type) || str(proxy.type) || "none",
    online:
      typeof settings.is_reachable === "boolean" ? settings.is_reachable : null,
    usable: typeof settings.is_usable === "boolean" ? settings.is_usable : null,
    settings: Object.fromEntries(
      serverSettingKeys
        .filter(
          ([key]) =>
            settings[key] !== undefined &&
            settings[key] !== null &&
            settings[key] !== "",
        )
        .map(([key, label]) => [
          label,
          typeof settings[key] === "boolean"
            ? settings[key]
              ? "Enabled"
              : "Disabled"
            : str(settings[key]),
        ]),
    ),
    resources: resources.map((r) => ({
      id: str(r.uuid),
      name: str(r.name),
      type: str(r.type),
      status: normalizeStatus(str(r.status)),
    })),
    domains: domains.map((d) => ({
      ip: str(d.ip),
      domains: Array.isArray(d.domains)
        ? d.domains.map(str).filter(Boolean)
        : [],
    })),
  };
}
export async function serverAction(
  id: string,
  action: "validate" | "restart-proxy" | "docker-cleanup",
) {
  const path = `/servers/${encodeURIComponent(id)}`;
  return coolifyRequest(
    action === "validate"
      ? `${path}/validate`
      : action === "restart-proxy"
        ? `${path}/proxy/restart`
        : `${path}/docker-cleanup/run`,
    "POST",
  );
}
