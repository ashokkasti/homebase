import { z } from "zod";
export const statusSchema = z.enum([
  "running",
  "deploying",
  "stopped",
  "failed",
  "unknown",
]);
export const resourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["app", "database", "service"]),
  status: statusSchema,
  domain: z.string(),
  description: z.string(),
  engine: z.string().optional(),
  branch: z.string(),
  environment: z.string(),
  environmentId: z.string().default(""),
  projectId: z.string().default(""),
  projectName: z.string().default(""),
  coolifyUrl: z.string(),
  components: z
    .array(
      z.object({
        id: z.string().optional(),
        kind: z.enum(["application", "database"]).optional(),
        name: z.string(),
        domain: z.string().optional(),
        status: statusSchema,
      }),
    )
    .default([]),
});
export type Resource = z.infer<typeof resourceSchema>;
export const deploymentSchema = z.object({
  id: z.string(),
  resourceId: z.string(),
  name: z.string(),
  status: z.enum(["successful", "failed", "deploying", "queued"]),
  branch: z.string(),
  commit: z.string(),
  message: z.string(),
  date: z.string(),
  duration: z.string(),
  logs: z.string().default(""),
});
export type Deployment = z.infer<typeof deploymentSchema>;
export const serverSchema = z.object({
  id: z.string(),
  name: z.string(),
  online: z.boolean().nullable(),
  ip: z.string(),
  os: z.string(),
  cpu: z.number().nullable(),
  memory: z.number().nullable(),
  memoryTotal: z.number().nullable(),
  storage: z.number().nullable(),
  storageTotal: z.number().nullable(),
});
export const backupExecutionSchema = z.object({
  id: z.string(),
  filename: z.string(),
  size: z.number().nullable(),
  date: z.string(),
  status: z.string(),
  message: z.string(),
});
export const backupSchema = z.object({
  id: z.string(),
  databaseId: z.string(),
  databaseName: z.string(),
  engine: z.string(),
  frequency: z.string(),
  enabled: z.boolean(),
  saveS3: z.boolean(),
  s3StorageId: z.string(),
  executions: z.array(backupExecutionSchema),
});
export type Backup = z.infer<typeof backupSchema>;
export const backupScheduleInputSchema = z.object({
  databaseId: z.string().min(1).max(128),
  frequency: z.enum(["hourly", "daily", "weekly", "monthly"]),
});
export const backupUpdateInputSchema = z.object({
  action: z.enum(["run", "enable", "disable", "delete"]),
  confirmation: z.string().max(128).optional(),
});
export const restoreInputSchema = z.object({
  source: z.enum(["server", "s3"]),
  path: z.string().trim().min(1).max(512),
  s3StorageId: z.string().max(128).optional(),
  confirmation: z.string().min(1).max(128),
  dumpAll: z.boolean().default(false),
});
export const dashboardSchema = z.object({
  demo: z.boolean(),
  connected: z.boolean(),
  coolifyUrl: z.string(),
  resources: z.array(resourceSchema),
  deployments: z.array(deploymentSchema),
  servers: z.array(serverSchema),
  warnings: z.array(z.string()),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
export const actionSchema = z.object({
  action: z.enum([
    "deploy",
    "force-deploy",
    "start",
    "restart",
    "stop",
    "delete",
  ]),
  confirmation: z.string().optional(),
  deleteVolumes: z.boolean().default(false),
});
export const connectionSchema = z.object({
  url: z.url().refine((v) => {
    const url = new URL(v);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }, "Use an HTTP or HTTPS URL without credentials, query parameters, or fragments"),
  token: z.string().min(8).max(4096),
});

// ───────────── Management (create / configure) ─────────────
// Coolify UUIDs are short alphanumeric strings. Rejecting anything else keeps
// user input from reshaping upstream API paths.
export const idSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, "Invalid identifier.");
export const kindSchema = z.enum(["app", "database", "service"]);
export type Kind = z.infer<typeof kindSchema>;
const fieldValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const configSchema = z.object({
  kind: kindSchema,
  fields: z.record(z.string(), fieldValue),
  info: z.record(z.string(), z.string()),
});
export type ResourceConfig = z.infer<typeof configSchema>;
export const configUpdateSchema = z.object({
  fields: z.record(z.string(), fieldValue),
  redeploy: z.boolean().default(false),
});
export const envSchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  isPreview: z.boolean(),
  isLiteral: z.boolean(),
  isMultiline: z.boolean(),
  isShownOnce: z.boolean(),
});
export type EnvVar = z.infer<typeof envSchema>;
export const envListSchema = z.object({ envs: z.array(envSchema) });
const envKey = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_.-]{0,255}$/,
    "Use letters, digits and underscores for keys.",
  );
export const envInputSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.enum(["create", "update"]),
    key: envKey,
    value: z.string().max(65536),
    isPreview: z.boolean().default(false),
    isLiteral: z.boolean().default(false),
    isMultiline: z.boolean().default(false),
  }),
  z.object({ op: z.literal("delete"), id: idSchema }),
  z.object({
    op: z.literal("bulk"),
    entries: z
      .array(z.object({ key: envKey, value: z.string().max(65536) }))
      .max(500),
  }),
]);
export const storageSchema = z.object({
  id: z.string(),
  type: z.enum(["persistent", "file"]),
  name: z.string(),
  mountPath: z.string(),
  hostPath: z.string(),
  content: z.string(),
  readOnly: z.boolean(),
});
export type Storage = z.infer<typeof storageSchema>;
export const storageListSchema = z.object({ storages: z.array(storageSchema) });
export const storageInputSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    type: z.enum(["persistent", "file"]),
    name: z.string().trim().max(255).default(""),
    mountPath: z.string().trim().min(1).max(1024).startsWith("/"),
    content: z.string().max(262144).default(""),
  }),
  z.object({
    op: z.literal("delete"),
    id: idSchema,
    confirmation: z.string().optional(),
  }),
]);
export const taskSchema = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string(),
  frequency: z.string(),
  container: z.string(),
  timeout: z.number().nullable(),
  enabled: z.boolean(),
  executions: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      message: z.string(),
      date: z.string(),
      duration: z.string(),
    }),
  ),
});
export type Task = z.infer<typeof taskSchema>;
export const taskListSchema = z.object({ tasks: z.array(taskSchema) });
export const taskInputSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.enum(["create", "update"]),
    id: idSchema.optional(),
    name: z.string().trim().min(1).max(255),
    command: z.string().trim().min(1).max(4096),
    frequency: z.string().trim().min(1).max(128),
    container: z.string().trim().max(255).default(""),
    timeout: z.number().int().min(1).max(36000).default(300),
    enabled: z.boolean().default(true),
  }),
  z.object({
    op: z.enum(["delete", "run", "enable", "disable"]),
    id: idSchema,
  }),
]);
export const logLineSchema = z.object({
  time: z.string(),
  text: z.string(),
  stream: z.enum(["stdout", "stderr"]),
  hidden: z.boolean(),
  command: z.string(),
});
export type LogLine = z.infer<typeof logLineSchema>;
export const deploymentDetailSchema = z.object({
  id: z.string(),
  status: deploymentSchema.shape.status,
  rawStatus: z.string(),
  applicationName: z.string(),
  serverName: z.string(),
  commit: z.string(),
  message: z.string(),
  createdAt: z.string(),
  finishedAt: z.string(),
  trigger: z.enum(["webhook", "api", "manual", "rollback"]),
  forceRebuild: z.boolean(),
  url: z.string(),
  lines: z.array(logLineSchema),
});
export type DeploymentDetail = z.infer<typeof deploymentDetailSchema>;
export const rollbackListSchema = z.object({
  current: z.string(),
  images: z.array(
    z.object({ tag: z.string(), date: z.string(), current: z.boolean() }),
  ),
});
export const metaSchema = z.object({
  version: z.string(),
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      environments: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  ),
  servers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      ip: z.string(),
      online: z.boolean().nullable(),
    }),
  ),
  githubApps: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type Meta = z.infer<typeof metaSchema>;
export const projectInputSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().max(1000).default(""),
  }),
  z.object({
    op: z.literal("create-environment"),
    projectId: idSchema,
    name: z
      .string()
      .trim()
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/,
        "Use letters, digits, dashes.",
      ),
  }),
  z.object({
    op: z.literal("delete"),
    projectId: idSchema,
    confirmation: z.string(),
  }),
  z.object({
    op: z.literal("delete-environment"),
    projectId: idSchema,
    environment: z.string().trim().min(1).max(64),
    confirmation: z.string(),
  }),
]);
export const serverDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  ip: z.string(),
  port: z.string(),
  user: z.string(),
  proxy: z.string(),
  online: z.boolean().nullable(),
  usable: z.boolean().nullable(),
  settings: z.record(z.string(), z.string()),
  resources: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      status: statusSchema,
    }),
  ),
  domains: z.array(z.object({ ip: z.string(), domains: z.array(z.string()) })),
});
export type ServerDetail = z.infer<typeof serverDetailSchema>;
export const serverActionSchema = z.object({
  action: z.enum(["validate", "restart-proxy", "docker-cleanup"]),
});
const location = {
  projectId: idSchema,
  environmentId: idSchema,
  environmentName: z.string().trim().min(1).max(64),
  serverId: idSchema,
  name: z.string().trim().max(255).default(""),
  description: z.string().trim().max(1000).default(""),
  instantDeploy: z.boolean().default(true),
};
const appCommon = {
  ...location,
  portsExposes: z
    .string()
    .trim()
    .regex(/^\d{1,5}(,\d{1,5})*$/, "Ports are numbers separated by commas.")
    .default("3000"),
  domains: z.string().trim().max(2048).default(""),
};
export const buildPackSchema = z.enum([
  "nixpacks",
  "railpack",
  "static",
  "dockerfile",
  "dockercompose",
]);
export const databaseEngineSchema = z.enum([
  "postgresql",
  "mysql",
  "mariadb",
  "mongodb",
  "redis",
  "keydb",
  "dragonfly",
  "clickhouse",
]);
export const createInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("app-git"),
    ...appCommon,
    githubAppId: idSchema.optional(),
    gitRepository: z.string().trim().min(3).max(1024),
    gitBranch: z.string().trim().min(1).max(255).default("main"),
    buildPack: buildPackSchema.default("nixpacks"),
    baseDirectory: z.string().trim().max(1024).default("/"),
  }),
  z.object({
    type: z.literal("app-image"),
    ...appCommon,
    image: z.string().trim().min(1).max(1024),
    tag: z.string().trim().max(128).default("latest"),
  }),
  z.object({
    type: z.literal("app-dockerfile"),
    ...appCommon,
    dockerfile: z.string().min(1).max(262144),
  }),
  z.object({
    type: z.literal("database"),
    ...location,
    engine: databaseEngineSchema,
    image: z.string().trim().max(255).default(""),
    isPublic: z.boolean().default(false),
    publicPort: z.number().int().min(1).max(65535).optional(),
  }),
  z.object({
    type: z.literal("service"),
    ...location,
    serviceType: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9._-]{0,127}$/)
      .optional(),
    compose: z.string().max(262144).optional(),
  }),
]);
export type CreateInput = z.infer<typeof createInputSchema>;

// ───────────── Domains ─────────────
export const redirectSchema = z.enum(["both", "www", "non-www"]);
export const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    "Enter a valid domain name.",
  );
export const domainSchema = z.object({
  url: z.string(),
  host: z.string(),
  scheme: z.enum(["http", "https"]),
  port: z.string(),
  path: z.string(),
  indexed: z.boolean(),
});
export type Domain = z.infer<typeof domainSchema>;
export const domainSettingsSchema = z.object({
  domains: z.array(domainSchema),
  forceHttps: z.boolean(),
  redirect: redirectSchema,
  defaultPort: z.string(),
  serverIps: z.array(z.string()),
  compose: z.boolean(),
});
export type DomainSettings = z.infer<typeof domainSettingsSchema>;
export const domainInputSchema = z.object({
  domains: z
    .array(
      z.object({
        host: hostnameSchema,
        scheme: z.enum(["http", "https"]),
        port: z
          .string()
          .trim()
          .regex(/^(\d{1,5})?$/, "Port must be a number.")
          .default(""),
        path: z
          .string()
          .trim()
          .regex(/^(\/[A-Za-z0-9._~\-/]*)?$/, "Paths start with /.")
          .default(""),
        indexed: z.boolean().default(true),
      }),
    )
    .max(50),
  forceHttps: z.boolean(),
  redirect: redirectSchema,
});
export const dnsResultSchema = z.object({
  host: z.string(),
  status: z.enum(["ok", "proxied", "mismatch", "missing", "error"]),
  addresses: z.array(z.string()),
  cname: z.array(z.string()),
  serverIps: z.array(z.string()),
});
export type DnsResult = z.infer<typeof dnsResultSchema>;

// ───────────── Containers & terminal ─────────────
export const containerSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  state: z.string(),
  status: z.string(),
  running: z.boolean(),
  serverId: z.string(),
  serverName: z.string(),
  // Service component the container belongs to, when the resource is a service.
  component: z.string().optional(),
});
export type Container = z.infer<typeof containerSchema>;
export const containerListSchema = z.object({
  containers: z.array(containerSchema),
  warnings: z.array(z.string()),
});
export const containerNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/, "Invalid container name.");
export const terminalOpenSchema = z.object({
  kind: kindSchema,
  resourceId: idSchema,
  container: containerNameSchema,
  cols: z.number().int().min(10).max(500).default(100),
  rows: z.number().int().min(5).max(200).default(30),
});
export const terminalInputSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("input"), data: z.string().max(65536) }),
  z.object({
    op: z.literal("resize"),
    cols: z.number().int().min(10).max(500),
    rows: z.number().int().min(5).max(200),
  }),
  z.object({ op: z.literal("close") }),
]);

// ───────────── Domain suggestions ─────────────
export const domainSuggestionSchema = z.object({
  host: z.string(),
  source: z.enum(["wildcard", "existing", "sslip"]),
  dns: z.enum(["ok", "proxied", "mismatch", "missing", "error"]),
});
export type DomainSuggestion = z.infer<typeof domainSuggestionSchema>;
export const domainSuggestionsSchema = z.object({
  suggestions: z.array(domainSuggestionSchema),
  // Hosts already used by other resources, mapped to the resource name.
  taken: z.record(z.string(), z.string()),
});
export type DomainSuggestions = z.infer<typeof domainSuggestionsSchema>;
