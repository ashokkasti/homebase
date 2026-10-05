// In-memory stand-ins for the management API in demo mode. Nothing here
// reaches Coolify; state resets when the server restarts.
import type { z } from "zod";
import { configFields } from "./config-fields";
import { classify, domainUrl, parseDomains } from "./coolify/domains";
import { demoData } from "./demo";
import { serviceTemplates } from "./service-templates";
import type {
  DnsResult,
  DomainSettings,
  domainInputSchema,
  CreateInput,
  DeploymentDetail,
  EnvVar,
  Kind,
  LogLine,
  Meta,
  Resource,
  ResourceConfig,
  ServerDetail,
  Storage,
  Task,
} from "./schemas";

const meta: Meta = {
  version: "4.0.0 (demo)",
  projects: [
    {
      id: "homelab",
      name: "Homelab",
      description: "Everything running at home.",
      environments: [
        { id: "production", name: "production" },
        { id: "staging", name: "staging" },
      ],
    },
  ],
  servers: [],
  githubApps: [{ id: "gh-demo", name: "homebase-bot" }],
};
export function demoMeta(): Meta {
  return {
    ...meta,
    servers: demoData.servers.map((s) => ({
      id: s.id,
      name: s.name,
      ip: s.ip,
      online: s.online,
    })),
  };
}

function find(kind: Kind, id: string) {
  const resource = demoData.resources.find(
    (r) => r.id === id && r.kind === kind,
  );
  if (!resource) throw new Error("Resource not found.");
  return resource;
}

const configs = new Map<string, ResourceConfig["fields"]>();
function seedConfig(resource: Resource): ResourceConfig["fields"] {
  const fields: ResourceConfig["fields"] = {};
  for (const def of configFields[resource.kind])
    fields[def.key] =
      def.type === "bool" ? false : def.type === "number" ? null : "";
  fields.name = resource.name;
  fields.description = resource.description;
  if (resource.kind === "app") {
    const image = resource.id === "immich";
    Object.assign(fields, {
      domains: resource.domain,
      git_repository: image ? "" : `https://github.com/example/${resource.id}`,
      git_branch: image ? "" : resource.branch || "main",
      docker_registry_image_name: image
        ? "ghcr.io/immich-app/immich-server"
        : "",
      docker_registry_image_tag: image ? "release" : "",
      build_pack: image ? "dockerimage" : "nixpacks",
      base_directory: "/",
      ports_exposes: image ? "2283" : "3000",
      redirect: "both",
      is_force_https_enabled: true,
      is_auto_deploy_enabled: !image,
      health_check_enabled: resource.id === "planner",
      health_check_path: "/health",
      health_check_port: "3000",
      health_check_return_code: 200,
      health_check_interval: 5,
      health_check_timeout: 5,
      health_check_retries: 10,
      limits_memory: "0",
      limits_cpus: "0",
      install_command: "",
      build_command: "npm run build",
      start_command: "npm start",
    });
  }
  if (resource.kind === "database")
    Object.assign(fields, {
      image: resource.description.toLowerCase().includes("redis")
        ? "redis:7.4-alpine"
        : "postgres:17-alpine",
      is_public: false,
      public_port: null,
      limits_memory: "0",
      limits_cpus: "0",
    });
  if (resource.kind === "service")
    Object.assign(fields, {
      connect_to_docker_network: true,
      docker_compose_raw: `services:\n  ${resource.id}:\n    image: ${resource.id}/${resource.id}:latest\n    environment:\n      - SERVICE_FQDN_${resource.id.toUpperCase()}_8080\n    volumes:\n      - ${resource.id}-data:/data\n    restart: unless-stopped\nvolumes:\n  ${resource.id}-data:\n`,
    });
  return fields;
}
export function demoConfig(kind: Kind, id: string): ResourceConfig {
  const resource = find(kind, id);
  if (!configs.has(id)) configs.set(id, seedConfig(resource));
  const fields = configs.get(id) ?? {};
  const info: Record<string, string> = { Status: `${resource.status}:healthy` };
  if (kind === "app") {
    info["Build pack"] = String(fields.build_pack || "nixpacks");
    info.Commit = "a83d9231f0c2";
  }
  if (kind === "database") {
    info.Engine = resource.description;
    info["Internal URL"] = `postgres://postgres:••••••@${id}:5432/postgres`;
  }
  if (kind === "service") info.Template = resource.id;
  info.Created = new Date(Date.now() - 40 * 86400000).toISOString();
  return { kind, fields, info };
}
export function demoUpdateConfig(
  kind: Kind,
  id: string,
  fields: ResourceConfig["fields"],
) {
  const resource = find(kind, id);
  const current = demoConfig(kind, id).fields;
  Object.assign(current, fields);
  if (typeof fields.name === "string" && fields.name)
    resource.name = fields.name;
  if (typeof fields.description === "string")
    resource.description = fields.description;
  if (typeof fields.domains === "string")
    resource.domain = fields.domains.split(",")[0]?.trim() ?? "";
  if (typeof fields.git_branch === "string")
    resource.branch = fields.git_branch;
}

const envs = new Map<string, EnvVar[]>();
let envCounter = 0;
function env(key: string, value: string, extra: Partial<EnvVar> = {}): EnvVar {
  envCounter += 1;
  return {
    id: `env-${envCounter}`,
    key,
    value,
    isPreview: false,
    isLiteral: false,
    isMultiline: false,
    isShownOnce: false,
    ...extra,
  };
}
export function demoEnvs(kind: Kind, id: string) {
  find(kind, id);
  if (!envs.has(id))
    envs.set(
      id,
      kind === "database"
        ? [
            env("POSTGRES_USER", "postgres"),
            env("POSTGRES_PASSWORD", "s3cr3t-demo-password"),
            env("POSTGRES_DB", "app"),
          ]
        : [
            env("NODE_ENV", "production"),
            env("DATABASE_URL", "postgres://app:s3cr3t@supabase-db:5432/app"),
            env("SESSION_SECRET", "9f8a7c6e5d4b3a2f1e0d9c8b7a6f5e4d"),
            env("LOG_LEVEL", "info"),
            env("PREVIEW_BANNER", "true", { isPreview: true }),
          ],
    );
  return envs.get(id) ?? [];
}
export function demoMutateEnv(
  kind: Kind,
  id: string,
  input:
    | {
        op: "create" | "update";
        key: string;
        value: string;
        isPreview: boolean;
        isLiteral: boolean;
        isMultiline: boolean;
      }
    | { op: "delete"; id: string }
    | { op: "bulk"; entries: { key: string; value: string }[] },
) {
  const list = demoEnvs(kind, id);
  if (input.op === "delete") {
    envs.set(
      id,
      list.filter((e) => e.id !== input.id),
    );
    return;
  }
  const entries =
    input.op === "bulk"
      ? input.entries.map((e) => ({
          ...e,
          isPreview: false,
          isLiteral: false,
          isMultiline: false,
        }))
      : [input];
  for (const entry of entries) {
    const existing = list.find(
      (e) => e.key === entry.key && e.isPreview === entry.isPreview,
    );
    if (input.op === "create" && existing)
      throw new Error(`${entry.key} already exists.`);
    if (existing) Object.assign(existing, entry);
    else list.push(env(entry.key, entry.value, entry));
  }
}

const storages = new Map<string, Storage[]>();
export function demoStorages(kind: Kind, id: string) {
  find(kind, id);
  if (!storages.has(id))
    storages.set(id, [
      {
        id: `vol-${id}`,
        type: "persistent",
        name: `${id}-data`,
        mountPath:
          kind === "database" ? "/var/lib/postgresql/data" : "/app/data",
        hostPath: "",
        content: "",
        readOnly: kind === "service",
      },
      ...(kind === "app"
        ? [
            {
              id: `file-${id}`,
              type: "file" as const,
              name: "config.json",
              mountPath: "/app/config.json",
              hostPath: `/data/coolify/applications/${id}/config.json`,
              content: '{\n  "featureFlags": { "beta": true }\n}',
              readOnly: false,
            },
          ]
        : []),
    ]);
  return storages.get(id) ?? [];
}
export function demoMutateStorage(
  kind: Kind,
  id: string,
  input:
    | {
        op: "create";
        type: "persistent" | "file";
        name: string;
        mountPath: string;
        content: string;
      }
    | { op: "delete"; id: string },
) {
  const list = demoStorages(kind, id);
  if (input.op === "delete") {
    const target = list.find((s) => s.id === input.id);
    if (target?.readOnly)
      throw new Error("This storage is managed by the compose file.");
    storages.set(
      id,
      list.filter((s) => s.id !== input.id),
    );
    return;
  }
  list.push({
    id: `storage-${Date.now()}`,
    type: input.type,
    name:
      input.type === "persistent"
        ? input.name || `${id}-volume`
        : (input.mountPath.split("/").pop() ?? ""),
    mountPath: input.mountPath,
    hostPath:
      input.type === "file"
        ? `/data/coolify/applications/${id}${input.mountPath}`
        : "",
    content: input.content,
    readOnly: false,
  });
}

const tasks = new Map<string, Task[]>();
export function demoTasks(kind: Kind, id: string) {
  find(kind, id);
  if (kind === "database") return [];
  if (!tasks.has(id))
    tasks.set(
      id,
      id === "planner"
        ? [
            {
              id: "task-cleanup",
              name: "Clean expired sessions",
              command: "node scripts/cleanup.js",
              frequency: "0 3 * * *",
              container: "",
              timeout: 300,
              enabled: true,
              executions: [
                {
                  id: "x1",
                  status: "success",
                  message: "Removed 214 sessions",
                  date: new Date(Date.now() - 9 * 3600000).toISOString(),
                  duration: "2.1",
                },
                {
                  id: "x2",
                  status: "success",
                  message: "Removed 198 sessions",
                  date: new Date(Date.now() - 33 * 3600000).toISOString(),
                  duration: "1.8",
                },
              ],
            },
            {
              id: "task-digest",
              name: "Weekly digest",
              command: "npm run digest",
              frequency: "weekly",
              container: "",
              timeout: 600,
              enabled: false,
              executions: [],
            },
          ]
        : [],
    );
  return tasks.get(id) ?? [];
}
export function demoMutateTask(
  kind: Kind,
  id: string,
  input:
    | {
        op: "create" | "update";
        id?: string;
        name: string;
        command: string;
        frequency: string;
        container: string;
        timeout: number;
        enabled: boolean;
      }
    | { op: "delete" | "run" | "enable" | "disable"; id: string },
) {
  if (kind === "database")
    throw new Error("Scheduled tasks are available for apps and services.");
  const list = demoTasks(kind, id);
  if (input.op === "create") {
    list.push({ ...input, id: `task-${Date.now()}`, executions: [] });
    return;
  }
  const task = list.find((t) => t.id === input.id);
  if (!task) throw new Error("Task not found.");
  if (input.op === "update") Object.assign(task, { ...input, id: task.id });
  else if (input.op === "delete")
    tasks.set(
      id,
      list.filter((t) => t.id !== input.id),
    );
  else if (input.op === "run")
    task.executions.unshift({
      id: `x-${Date.now()}`,
      status: "success",
      message: `$ ${task.command}\nDone.`,
      date: new Date().toISOString(),
      duration: "0.9",
    });
  else task.enabled = input.op === "enable";
}

// Demo deployments stream log lines over ~10 seconds.
const deploymentLines = new Map<string, LogLine[]>();
const script: [string, LogLine["stream"]?, boolean?][] = [
  ["Starting deployment of {name} to Home Server."],
  ["docker network inspect coolify >/dev/null", "stdout", true],
  [
    "Preparing container with helper image: ghcr.io/coollabsio/coolify-helper:1.0.8.",
  ],
  ["Importing example/{id}:main (commit sha HEAD) to /artifacts/{id}."],
  ["Cloning into '/artifacts/{id}'...", "stderr"],
  ["Generating nixpacks configuration with: nixpacks plan -f toml"],
  ["╔══════════════ Nixpacks v1.29.1 ══════════════╗"],
  ["║ setup      │ nodejs_22, npm-9_x                ║"],
  ["║ install    │ npm ci                            ║"],
  ["║ build      │ npm run build                     ║"],
  ["║ start      │ npm start                         ║"],
  ["╚═══════════════════════════════════════════════╝"],
  ["Building docker image started."],
  ["#8 [stage-0  4/9] RUN npm ci", "stdout", true],
  ["#8 12.31 added 412 packages, and audited 413 packages in 11s"],
  [
    "#8 12.32 npm warn deprecated inflight@1.0.6: This module is not supported",
    "stderr",
  ],
  ["#11 [stage-0  7/9] RUN npm run build"],
  ["#11 3.904 ✓ Compiled successfully in 3.1s"],
  ["#11 4.512 ✓ Generating static pages (12/12)"],
  ["Building docker image completed."],
  ["Rolling update started."],
  ["Waiting for healthcheck to pass on the new container."],
  ["Healthcheck status: healthy"],
  ["Removing old containers."],
  ["Rolling update completed."],
  ["New container started."],
];
function linesFromText(text: string, date: string): LogLine[] {
  const start = Date.parse(date) || Date.now();
  return text.split("\n").map((line, i) => ({
    time: new Date(start + i * 900).toISOString(),
    text: line,
    stream: /error|exited with code/i.test(line) ? "stderr" : "stdout",
    hidden: false,
    command: "",
  }));
}
export function demoDeploy(resource: Resource, force = false) {
  const id = `demo-${Date.now().toString(36)}`;
  resource.status = "deploying";
  const deployment = {
    id,
    resourceId: resource.id,
    name: resource.name,
    status: "deploying" as const,
    branch: resource.branch,
    commit: Math.random().toString(16).slice(2, 9),
    message: force ? "Force rebuild" : "Manual deployment",
    date: new Date().toISOString(),
    duration: "",
    logs: "",
  };
  demoData.deployments.unshift(deployment);
  const lines: LogLine[] = [];
  deploymentLines.set(id, lines);
  let step = 0;
  const timer = setInterval(() => {
    const current = demoData.deployments.find((d) => d.id === id);
    if (!current || current.status !== "deploying") {
      clearInterval(timer);
      return;
    }
    const [text, stream = "stdout", hidden = false] = script[step] ?? [""];
    lines.push({
      time: new Date().toISOString(),
      text: text
        .replaceAll("{name}", resource.name)
        .replaceAll("{id}", resource.id),
      stream,
      hidden,
      command: hidden ? text : "",
    });
    step += 1;
    if (step >= script.length) {
      clearInterval(timer);
      current.status = "successful";
      current.duration = `${Math.round((Date.now() - Date.parse(current.date)) / 1000)}s`;
      resource.status = "running";
    }
  }, 380);
  return id;
}
export function demoDeploymentDetail(id: string): DeploymentDetail {
  const d = demoData.deployments.find((item) => item.id === id);
  if (!d) throw new Error("Deployment not found.");
  const finished = d.status === "successful" || d.status === "failed";
  return {
    id: d.id,
    status: d.status,
    rawStatus:
      d.status === "successful"
        ? "finished"
        : d.status === "deploying"
          ? "in_progress"
          : d.status,
    applicationName: d.name,
    serverName: "Home Server",
    commit: d.commit,
    message: d.message,
    createdAt: d.date,
    finishedAt: finished
      ? new Date(
          Date.parse(d.date) + (parseInt(d.duration) || 30) * 1000,
        ).toISOString()
      : "",
    trigger: d.message === "Manual deployment" ? "manual" : "webhook",
    forceRebuild: d.message === "Force rebuild",
    url: "",
    lines: deploymentLines.get(id) ?? linesFromText(d.logs, d.date),
  };
}
export function demoCancel(id: string) {
  const d = demoData.deployments.find((item) => item.id === id);
  if (!d || (d.status !== "deploying" && d.status !== "queued"))
    throw new Error("Only running deployments can be cancelled.");
  d.status = "failed";
  d.duration = `${Math.round((Date.now() - Date.parse(d.date)) / 1000)}s`;
  deploymentLines.get(id)?.push({
    time: new Date().toISOString(),
    text: "Deployment cancelled by user.",
    stream: "stderr",
    hidden: false,
    command: "",
  });
  const resource = demoData.resources.find((r) => r.id === d.resourceId);
  if (resource) resource.status = "running";
}
export function demoRollbackImages(id: string) {
  const deployments = demoData.deployments.filter(
    (d) => d.resourceId === id && d.status === "successful",
  );
  return {
    current: deployments[0]?.commit ?? "",
    images: deployments.map((d, i) => ({
      tag: d.commit,
      date: d.date,
      current: i === 0,
    })),
  };
}

export function demoCreate(input: CreateInput) {
  const kind: Kind =
    input.type === "database"
      ? "database"
      : input.type === "service"
        ? "service"
        : "app";
  const project = meta.projects.find((p) => p.id === input.projectId);
  const environment = project?.environments.find(
    (e) => e.id === input.environmentId,
  );
  const slug =
    (input.type === "service" ? input.serviceType : undefined) ??
    (input.type === "database" ? input.engine : kind);
  const id = `${slug ?? kind}-${Date.now().toString(36)}`;
  const template =
    input.type === "service"
      ? serviceTemplates.find(([s]) => s === input.serviceType)
      : undefined;
  const resource: Resource = {
    id,
    name:
      input.name ||
      (input.type === "app-git"
        ? input.gitRepository
            .split("/")
            .pop()
            ?.replace(/\.git$/, "") || "New app"
        : input.type === "app-image"
          ? input.image.split("/").pop() || "New app"
          : input.type === "database"
            ? `${input.engine} database`
            : input.type === "service"
              ? (input.serviceType ?? "Custom service")
              : "New app"),
    kind,
    status: input.instantDeploy
      ? kind === "app"
        ? "deploying"
        : "running"
      : "stopped",
    domain:
      "domains" in input && input.domains
        ? (input.domains.split(",")[0] ?? "")
        : "",
    description:
      input.description ||
      template?.[1] ||
      (input.type === "database" ? input.engine : ""),
    engine: input.type === "database" ? input.engine : "",
    branch: input.type === "app-git" ? input.gitBranch : "",
    environment: environment?.name ?? "production",
    environmentId: input.environmentId,
    projectId: input.projectId,
    projectName: project?.name ?? "",
    coolifyUrl: "",
    components:
      input.type === "service"
        ? [
            {
              id: `${id}-app`,
              kind: "application",
              name: resource0(input.serviceType),
              status: "running",
            },
          ]
        : [],
  };
  demoData.resources.push(resource);
  let deploymentId: string | undefined;
  if (kind === "app" && input.instantDeploy)
    deploymentId = demoDeploy(resource);
  return { id, kind, deploymentId };
}
function resource0(name?: string) {
  return name ? (name.split("-")[0] ?? name) : "app";
}
export function demoMutateProject(
  input:
    | { op: "create"; name: string; description: string }
    | { op: "create-environment"; projectId: string; name: string }
    | { op: "delete"; projectId: string; confirmation: string }
    | {
        op: "delete-environment";
        projectId: string;
        environment: string;
        confirmation: string;
      },
) {
  if (input.op === "create") {
    meta.projects.push({
      id: `project-${Date.now().toString(36)}`,
      name: input.name,
      description: input.description,
      environments: [
        { id: `env-${Date.now().toString(36)}`, name: "production" },
      ],
    });
    return;
  }
  const project = meta.projects.find((p) => p.id === input.projectId);
  if (!project) throw new Error("Project not found.");
  if (input.op === "create-environment") {
    if (project.environments.some((e) => e.name === input.name))
      throw new Error("Environment already exists.");
    project.environments.push({
      id: `env-${Date.now().toString(36)}`,
      name: input.name,
    });
    return;
  }
  if (input.op === "delete") {
    if (input.confirmation !== project.name)
      throw new Error("Type the project name to confirm.");
    if (demoData.resources.some((r) => r.projectId === project.id))
      throw new Error("Coolify: Project has resources, delete them first.");
    meta.projects = meta.projects.filter((p) => p.id !== project.id);
    return;
  }
  if (input.confirmation !== input.environment)
    throw new Error("Type the environment name to confirm.");
  const environment = project.environments.find(
    (e) => e.name === input.environment || e.id === input.environment,
  );
  if (
    environment &&
    demoData.resources.some((r) => r.environmentId === environment.id)
  )
    throw new Error("Coolify: Environment has resources, delete them first.");
  project.environments = project.environments.filter((e) => e !== environment);
}

export function demoServerDetail(id: string): ServerDetail {
  const server = demoData.servers.find((s) => s.id === id);
  if (!server) throw new Error("Server not found.");
  return {
    id: server.id,
    name: server.name,
    description: "The little box under the desk.",
    ip: server.ip,
    port: "22",
    user: "root",
    proxy: "traefik",
    online: server.online,
    usable: true,
    settings: {
      Role: "deployment",
      Docker: "27.3.1",
      Compose: "2.29.7",
      "Wildcard domain": "https://example.com",
      "Concurrent builds": "2",
      "Build server": "Disabled",
      Metrics: "Enabled",
      "Cleanup schedule": "0 0 * * *",
      "Cleanup threshold %": "80",
    },
    resources: demoData.resources.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.kind === "app" ? "application" : r.kind,
      status: r.status,
    })),
    domains: [
      {
        ip: server.ip,
        domains: demoData.resources
          .map((r) => r.domain)
          .filter(Boolean)
          .map((d) => new URL(d).hostname),
      },
    ],
  };
}

// Demo domains and DNS: hosts ending in .example.com resolve to the server,
// the tunnel-backed ones look proxied, anything else has no record.
const domainSettings = new Map<
  string,
  {
    urls: string[];
    noindex: string[];
    forceHttps: boolean;
    redirect: "both" | "www" | "non-www";
  }
>();
function demoDomainState(id: string) {
  const resource = find("app", id);
  if (!domainSettings.has(id))
    domainSettings.set(id, {
      urls: resource.domain
        ? [
            resource.domain.replace(/\/$/, ""),
            ...(id === "trekking"
              ? ["https://www.trekkingbootsnepal.com"]
              : []),
          ]
        : [],
      noindex: id === "planner" ? [resource.domain.replace(/\/$/, "")] : [],
      forceHttps: true,
      redirect: id === "trekking" ? "non-www" : "both",
    });
  return domainSettings.get(id)!;
}
export function demoDomainSettings(id: string): DomainSettings {
  const state = demoDomainState(id);
  return {
    domains: parseDomains(state.urls.join(","), state.noindex),
    forceHttps: state.forceHttps,
    redirect: state.redirect,
    defaultPort: id === "immich" ? "2283" : "3000",
    serverIps: demoData.servers.map((s) => s.ip),
    compose: false,
  };
}
export function demoUpdateDomains(
  id: string,
  input: z.infer<typeof domainInputSchema>,
) {
  const state = demoDomainState(id);
  state.urls = input.domains.map(domainUrl);
  state.noindex = input.domains.filter((d) => !d.indexed).map(domainUrl);
  state.forceHttps = input.forceHttps;
  state.redirect = input.redirect;
  const resource = find("app", id);
  resource.domain = state.urls[0] ?? "";
}
export function demoDns(host: string): DnsResult {
  const ips = demoData.servers.map((s) => s.ip);
  if (host.endsWith("trekkingbootsnepal.com"))
    return classify(host, ["104.21.48.10", "172.67.140.2"], [], ips);
  if (host.endsWith(".example.com"))
    return classify(host, [ips[0] ?? "192.168.1.100"], [], ips);
  if (host.includes("staging")) return classify(host, ["203.0.113.9"], [], ips);
  return classify(host, [], [], ips);
}
