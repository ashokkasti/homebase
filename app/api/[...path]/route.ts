import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authorized,
  clearSession,
  loginConfigurationError,
  rateLimit,
  setSession,
  verifyOrigin,
  verifyPassword,
} from "@/lib/auth";
import { getDashboard } from "@/lib/coolify/dashboard";
import { coolifyRequest, rawResourceSchema } from "@/lib/coolify/client";
import { saveConfig } from "@/lib/coolify/config";
import { resourceAction } from "@/lib/coolify/resources";
import { serviceComponentAction } from "@/lib/coolify/resources";
import { getBackups } from "@/lib/coolify/backups";
import { getDeploymentLogs } from "@/lib/coolify/deployments";
import {
  actionSchema,
  backupScheduleInputSchema,
  backupUpdateInputSchema,
  connectionSchema,
  dashboardSchema,
  restoreInputSchema,
} from "@/lib/schemas";
import { demoBackups, demoData, isDemo } from "@/lib/demo";
import { demoDeploy, demoDeploymentDetail } from "@/lib/demo-store";
import { manageGet, managePost } from "@/lib/api/manage";
import {
  openTerminal,
  terminalInput,
  terminalStream,
} from "@/lib/api/terminal";
import { getDomainSuggestions } from "@/lib/coolify/domain-suggestions";
import { demoDomainSuggestions } from "@/lib/demo-store";
import { idSchema } from "@/lib/schemas";
import {
  listPasskeys,
  loginOptions,
  registerPasskey,
  registrationOptions,
  removePasskey,
  verifyPasskeyLogin,
} from "@/lib/auth/passkeys";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
export const runtime = "nodejs";
const isObject = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
function json(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
function failure(error: unknown) {
  const message =
    error instanceof z.ZodError
      ? "Invalid request. Check the submitted fields."
      : error instanceof Error
        ? error.message
        : "Request failed.";
  return json({ error: message }, message.startsWith("Too many") ? 429 : 400);
}
export async function GET(request: Request, context: Context) {
  try {
    if (!(await authorized()))
      return json({ error: "Sign in to continue." }, 401);
    const { path } = await context.params;
    const route = path.join("/");
    if (path[0] === "terminal" && path.length === 2)
      return terminalStream(path[1] ?? "", request);
    if (route === "auth/passkeys")
      return json({ passkeys: await listPasskeys() });
    if (route === "domains/suggest") {
      const params = new URL(request.url).searchParams;
      const text = z.string().trim().max(100).catch("");
      const input = {
        name: text.parse(params.get("name") ?? ""),
        environment: text.parse(params.get("environment") ?? ""),
        project: text.parse(params.get("project") ?? ""),
        resourceId: params.get("resourceId")
          ? idSchema.parse(params.get("resourceId"))
          : undefined,
      };
      return json(
        isDemo()
          ? await demoDomainSuggestions(input)
          : await getDomainSuggestions(input),
      );
    }
    const managed = await manageGet(path);
    if (managed !== undefined) return json(managed);
    if (
      ["apps", "databases", "services", "deployments", "server"].includes(
        path[0] ?? "",
      )
    ) {
      const data = await getDashboard();
      if (path[0] === "deployments") return json(data.deployments);
      if (path[0] === "server") return json(data.servers);
      const kind =
        path[0] === "apps"
          ? "app"
          : path[0] === "databases"
            ? "database"
            : "service";
      const resources = data.resources.filter((r) => r.kind === kind);
      if (path[1]) {
        const resource = resources.find((r) => r.id === path[1]);
        return resource
          ? json(resource)
          : json({ error: "Resource not found." }, 404);
      }
      return json(resources);
    }
    if (route === "dashboard")
      return json(dashboardSchema.parse(await getDashboard()));
    if (route === "backups") {
      if (isDemo()) return json({ backups: demoBackups, warnings: [] });
      const dashboard = await getDashboard();
      const result = await getBackups(dashboard.resources);
      return json(result);
    }
    if (route === "logs") {
      const params = new URL(request.url).searchParams;
      const id = z.string().min(1).max(128).parse(params.get("id"));
      const type = z
        .enum([
          "deployment",
          "app",
          "database",
          "service-application",
          "service-database",
        ])
        .parse(params.get("type"));
      const deployment = type === "deployment";
      const lines = z.coerce
        .number()
        .int()
        .min(10)
        .max(5000)
        .catch(200)
        .parse(params.get("lines") ?? 200);
      if (isDemo()) {
        return json({
          logs: deployment
            ? demoDeploymentDetail(id)
                .lines.map((line) => line.text)
                .join("\n")
            : demoRuntimeLogs(id, lines),
        });
      }
      if (deployment) return json({ logs: await getDeploymentLogs(id) });
      const dashboard = await getDashboard();
      if (type === "app" || type === "database") {
        const kind = type === "app" ? "app" : "database";
        if (
          !dashboard.resources.some(
            (resource) => resource.id === id && resource.kind === kind,
          )
        )
          return json({ error: "Resource not found." }, 404);
        const route = type === "app" ? "applications" : "databases";
        return json(
          z
            .object({ logs: z.string() })
            .parse(
              await coolifyRequest(
                `/${route}/${encodeURIComponent(id)}/logs?lines=${lines}`,
              ),
            ),
        );
      }
      const serviceId = z
        .string()
        .min(1)
        .max(128)
        .parse(params.get("serviceId"));
      const kind = type === "service-application" ? "application" : "database";
      const service = dashboard.resources.find(
        (resource) => resource.id === serviceId && resource.kind === "service",
      );
      if (
        !service?.components.some(
          (component) => component.id === id && component.kind === kind,
        )
      )
        return json({ error: "Service component not found." }, 404);
      const componentRoute =
        kind === "application" ? "applications" : "databases";
      const data = z
        .object({ logs: z.string() })
        .parse(
          await coolifyRequest(
            `/services/${encodeURIComponent(serviceId)}/${componentRoute}/${encodeURIComponent(id)}/logs?lines=${lines}`,
          ),
        );
      return json(data);
    }
    return json({ error: "Not found." }, 404);
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const { path } = await context.params;
    const route = path.join("/");
    if (route === "auth/login") {
      rateLimit("login-global", 10);
      const configurationError = loginConfigurationError();
      if (configurationError) return json({ error: configurationError }, 503);
      const body = z
        .object({
          email: z.string().trim().toLowerCase().pipe(z.email()),
          password: z.string().min(1).max(512),
        })
        .parse(await request.json());
      if (
        body.email !== process.env.HOMEBASE_ADMIN_EMAIL?.trim().toLowerCase() ||
        !verifyPassword(body.password)
      )
        return json({ error: "Incorrect email or password." }, 401);
      await setSession();
      return json({ ok: true });
    }
    if (route === "auth/passkey/options" || route === "auth/passkey/login") {
      rateLimit("login-global", 10);
      const configurationError = loginConfigurationError();
      if (configurationError && !isDemo())
        return json({ error: configurationError }, 503);
      if (route === "auth/passkey/options")
        return json(await loginOptions(request));
      const body = z
        .object({ response: z.custom<AuthenticationResponseJSON>(isObject) })
        .parse(await request.json());
      try {
        await verifyPasskeyLogin(request, body.response);
      } catch {
        return json(
          { error: "Passkey sign-in failed. Use your password." },
          401,
        );
      }
      await setSession();
      return json({ ok: true });
    }
    if (!(await authorized()))
      return json({ error: "Sign in to continue." }, 401);
    if (route === "auth/passkeys/options")
      return json(await registrationOptions(request));
    if (route === "auth/passkeys/register") {
      const body = z
        .object({
          response: z.custom<RegistrationResponseJSON>(isObject),
          name: z.string().trim().max(60).default(""),
        })
        .parse(await request.json());
      await registerPasskey(request, body);
      return json({ ok: true });
    }
    if (route === "auth/passkeys/delete") {
      const body = z
        .object({ id: z.string().min(1).max(1024) })
        .parse(await request.json());
      await removePasskey(body.id);
      return json({ ok: true });
    }
    // Keystrokes are frequent; they bypass the admin action limit.
    if (path[0] === "terminal" && path.length === 2)
      return json(terminalInput(path[1] ?? "", await request.json()));
    rateLimit("admin-actions");
    if (route === "terminal") {
      rateLimit("terminal-open", 10);
      return json(await openTerminal(await request.json()));
    }
    const managed = await managePost(path, () => request.json());
    if (managed !== undefined) return json(managed);
    if (route === "auth/logout") {
      await clearSession();
      return json({ ok: true });
    }
    if (route === "connection") {
      if (isDemo())
        return json(
          {
            error:
              "Run with HOMEBASE_DEMO=false and configured administrator credentials to connect a real server.",
          },
          400,
        );
      const input = z
        .object({
          url: connectionSchema.shape.url,
          token: connectionSchema.shape.token,
          save: z.boolean().default(false),
        })
        .parse(await request.json());
      const config = connectionSchema.parse(input);
      const apps = z
        .array(rawResourceSchema)
        .parse(await coolifyRequest("/applications", "GET", config));
      if (input.save) await saveConfig(config);
      return json({ ok: true, count: apps.length });
    }
    if (path[0] === "resources" && path.length === 3 && path[2] === "action") {
      const id = z.string().min(1).max(128).parse(path[1]);
      const body = actionSchema.parse(await request.json());
      const dashboard = await getDashboard();
      const resource = dashboard.resources.find((r) => r.id === id);
      if (!resource) return json({ error: "Resource not found." }, 404);
      if (
        ["restart", "stop", "delete"].includes(body.action) &&
        body.confirmation !== resource.name
      )
        return json({ error: "Explicit confirmation is required." }, 400);
      if (isDemo()) {
        if (body.action === "delete") {
          demoData.resources = demoData.resources.filter((r) => r.id !== id);
        } else if (body.action === "stop") {
          resource.status = "stopped";
        } else if (body.action === "restart" || body.action === "start") {
          resource.status = "running";
        } else {
          if (resource.kind === "database")
            return json({ error: "Databases are started, not deployed." }, 400);
          return json({
            ok: true,
            demo: true,
            deploymentId: demoDeploy(resource, body.action === "force-deploy"),
          });
        }
        return json({ ok: true, demo: true });
      }
      const result = await resourceAction(resource.kind, id, body.action, {
        deleteVolumes: body.deleteVolumes,
      });
      return json({ ok: true, deploymentId: result.deploymentId });
    }
    if (path[0] === "service-components" && path[1] === "action") {
      const body = z
        .object({
          serviceId: z.string().min(1).max(128),
          componentId: z.string().min(1).max(128),
          kind: z.enum(["application", "database"]),
          action: z.enum(["start", "restart", "stop"]),
          confirmation: z.string().optional(),
        })
        .parse(await request.json());
      const dashboard = await getDashboard();
      const service = dashboard.resources.find(
        (resource) =>
          resource.id === body.serviceId && resource.kind === "service",
      );
      const component = service?.components.find(
        (item) => item.id === body.componentId && item.kind === body.kind,
      );
      if (!component)
        return json({ error: "Service component not found." }, 404);
      if (body.action !== "start" && body.confirmation !== component.name)
        return json({ error: "Explicit confirmation is required." }, 400);
      if (isDemo()) {
        component.status = body.action === "stop" ? "stopped" : "running";
        return json({ ok: true, demo: true });
      }
      const result = await serviceComponentAction(
        body.serviceId,
        body.componentId,
        body.kind,
        body.action,
      );
      return json({ ok: true, result });
    }
    if (path[0] === "backups" && path[1] === "schedule" && path.length === 2) {
      const body = backupScheduleInputSchema.parse(await request.json());
      const dashboard = await getDashboard();
      const database = dashboard.resources.find(
        (resource) =>
          resource.id === body.databaseId && resource.kind === "database",
      );
      if (!database) return json({ error: "Database not found." }, 404);
      if (isDemo()) {
        demoBackups.unshift({
          id: `demo-backup-${Date.now()}`,
          databaseId: database.id,
          databaseName: database.name,
          engine: database.engine ?? database.description,
          frequency: body.frequency,
          enabled: true,
          saveS3: false,
          s3StorageId: "",
          executions: [],
        });
        return json({ ok: true, demo: true });
      }
      const result = await coolifyRequest(
        `/databases/${encodeURIComponent(database.id)}/backups`,
        "POST",
        undefined,
        { frequency: body.frequency, enabled: true, backup_now: false },
      );
      return json({ ok: true, result });
    }
    if (path[0] === "backups" && path.length === 3) {
      const databaseId = z.string().min(1).max(128).parse(path[1]);
      const scheduleId = z.string().min(1).max(128).parse(path[2]);
      const body = backupUpdateInputSchema.parse(await request.json());
      const dashboard = await getDashboard();
      const database = dashboard.resources.find(
        (resource) =>
          resource.id === databaseId && resource.kind === "database",
      );
      if (!database) return json({ error: "Database not found." }, 404);
      const listing = isDemo()
        ? demoBackups.filter((backup) => backup.databaseId === databaseId)
        : (await getBackups([database])).backups;
      const schedule = listing.find((backup) => backup.id === scheduleId);
      if (!schedule) return json({ error: "Backup schedule not found." }, 404);
      if (body.action === "delete") {
        if (body.confirmation !== schedule.databaseName)
          return json({ error: "Explicit confirmation is required." }, 400);
        if (isDemo()) {
          const index = demoBackups.findIndex(
            (backup) => backup.id === scheduleId,
          );
          if (index >= 0) demoBackups.splice(index, 1);
        } else {
          await coolifyRequest(
            `/databases/${encodeURIComponent(databaseId)}/backups/${encodeURIComponent(scheduleId)}`,
            "DELETE",
          );
        }
        return json({ ok: true });
      }
      if (isDemo()) {
        const backup = demoBackups.find((item) => item.id === scheduleId);
        if (backup) {
          if (body.action === "run") {
            backup.executions.unshift({
              id: `demo-execution-${Date.now()}`,
              filename: `${database.name.toLowerCase().replaceAll(" ", "-")}-${new Date().toISOString().slice(0, 10)}.sql.gz`,
              size: 1400000000,
              date: new Date().toISOString(),
              status: "success",
              message: "",
            });
          } else backup.enabled = body.action === "enable";
        }
        return json({ ok: true, demo: true });
      }
      const result = await coolifyRequest(
        `/databases/${encodeURIComponent(databaseId)}/backups/${encodeURIComponent(scheduleId)}`,
        "PATCH",
        undefined,
        body.action === "run"
          ? { backup_now: true }
          : { enabled: body.action === "enable" },
      );
      return json({ ok: true, result });
    }
    if (path[0] === "databases" && path.length === 3 && path[2] === "restore") {
      const databaseId = z.string().min(1).max(128).parse(path[1]);
      const body = restoreInputSchema.parse(await request.json());
      const dashboard = await getDashboard();
      const database = dashboard.resources.find(
        (resource) =>
          resource.id === databaseId && resource.kind === "database",
      );
      if (!database) return json({ error: "Database not found." }, 404);
      if (body.confirmation !== database.name)
        return json(
          { error: "Type the database name to confirm restore." },
          400,
        );
      if (body.source === "s3" && !body.s3StorageId)
        return json(
          { error: "Choose an S3 storage configuration in Coolify first." },
          400,
        );
      if (body.source === "server" && !body.path.startsWith("/"))
        return json(
          {
            error:
              "Enter the full absolute path to the backup file on the server.",
          },
          400,
        );
      if (isDemo()) return json({ ok: true, demo: true });
      const result = await coolifyRequest(
        `/databases/${encodeURIComponent(databaseId)}/imports`,
        "POST",
        undefined,
        {
          source: body.source,
          path: body.path,
          ...(body.source === "s3"
            ? { s3_storage_uuid: body.s3StorageId }
            : {}),
          dump_all: body.dumpAll,
          replace_existing: true,
        },
      );
      return json({ ok: true, result });
    }
    return json({ error: "Not found." }, 404);
  } catch (error) {
    return failure(error);
  }
}

function demoRuntimeLogs(id: string, lines: number) {
  const now = Date.now();
  const messages = [
    "info  Server started in production mode",
    "info  Connected to PostgreSQL (pool size 10)",
    "info  Listening on http://0.0.0.0:3000",
    "info  GET /health 200 2ms",
    "info  GET /api/status 200 14ms",
    "warn  Slow query detected (412ms): SELECT * FROM itineraries",
    "info  POST /api/session 201 38ms",
    "error Failed to send email: connect ETIMEDOUT 10.0.0.12:587",
    "info  GET /api/trips?page=2 200 21ms",
    "info  Cache warmed (128 keys)",
  ];
  const count = Math.min(lines, 80);
  return Array.from({ length: count }, (_, i) => {
    const time = new Date(now - (count - i) * 7000).toISOString();
    return `${time} [${id}] ${messages[(i * 7 + id.length) % messages.length]}`;
  }).join("\n");
}
