import { z } from "zod";
import { coolifyRequest } from "./client";
import { sshExec } from "./ssh";
import type { Container, Resource } from "../schemas";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : {};
const str = (v: unknown) =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";

type ServerRef = { id: string; name: string };

// Which servers host a resource. Coolify lists resources per server.
async function serversFor(resourceId: string): Promise<ServerRef[]> {
  const servers = z
    .array(z.object({ uuid: z.string(), name: z.string().nullish() }))
    .parse(await coolifyRequest("/servers"));
  const hosting = await Promise.all(
    servers.map(async (s) => {
      const resources = await coolifyRequest(
        `/servers/${encodeURIComponent(s.uuid)}/resources`,
      ).catch(() => []);
      const ids = Array.isArray(resources)
        ? resources.map((r) => str(rec(r).uuid))
        : [];
      return ids.includes(resourceId) ? s : null;
    }),
  );
  return hosting
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .map((s) => ({ id: s.uuid, name: s.name ?? s.uuid }));
}

const psLine = z.object({
  ID: z.string(),
  Names: z.string(),
  Image: z.string().default(""),
  State: z.string().default(""),
  Status: z.string().default(""),
});

export async function serverContainers(server: ServerRef) {
  const output = await sshExec(
    server.id,
    (docker) => `${docker} ps -a --no-trunc --format '{{json .}}'`,
  );
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [psLine.parse(JSON.parse(line))];
      } catch {
        return [];
      }
    })
    .map((c): Container => ({
      id: c.ID.slice(0, 12),
      name: c.Names.split(",")[0] ?? c.Names,
      image: c.Image,
      state: c.State,
      status: c.Status,
      running: c.State === "running",
      serverId: server.id,
      serverName: server.name,
    }));
}

// Coolify names containers after the resource UUID: apps `<uuid>-<timestamp>`,
// databases `<uuid>`, service components `<component>-<service uuid>`.
export function matchContainers(
  resource: Pick<Resource, "id" | "kind" | "components">,
  containers: Container[],
) {
  return containers
    .filter((c) => c.name.includes(resource.id))
    .map((c) => {
      if (resource.kind !== "service") return c;
      const component = resource.components
        .map((x) => x.name)
        .sort((a, b) => b.length - a.length)
        .find((name) => c.name.startsWith(`${name}-${resource.id}`));
      return component ? { ...c, component } : c;
    })
    .sort(
      (a, b) =>
        Number(b.running) - Number(a.running) || a.name.localeCompare(b.name),
    );
}

export async function getContainers(
  resource: Pick<Resource, "id" | "kind" | "components">,
) {
  const servers = await serversFor(resource.id);
  const warnings: string[] = [];
  if (servers.length === 0)
    warnings.push("Coolify did not report which server runs this resource.");
  const lists = await Promise.all(
    servers.map((server) =>
      serverContainers(server).catch((error: unknown) => {
        warnings.push(
          `${server.name}: ${error instanceof Error ? error.message : "unreachable"}`,
        );
        return [];
      }),
    ),
  );
  return {
    containers: matchContainers(resource, lists.flat()),
    warnings,
  };
}
