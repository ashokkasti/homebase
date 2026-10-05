// Management endpoints: /api/meta, /api/resources/:kind/:id/*, /api/deployments/:id,
// /api/projects, /api/servers/:id. Returns undefined when a path is not handled here.
import { z } from "zod";
import * as live from "../coolify/manage";
import * as demo from "../demo-store";
import { checkDns, getDomainSettings, updateDomains } from "../coolify/domains";
import { demoData, isDemo } from "../demo";
import {
  configUpdateSchema,
  domainInputSchema,
  hostnameSchema,
  createInputSchema,
  envInputSchema,
  idSchema,
  kindSchema,
  projectInputSchema,
  serverActionSchema,
  storageInputSchema,
  taskInputSchema,
} from "../schemas";
import { resourceAction } from "../coolify/resources";
import { editableKeys } from "../config-fields";

function target(path: string[]) {
  return { kind: kindSchema.parse(path[1]), id: idSchema.parse(path[2]) };
}

export async function manageGet(path: string[]): Promise<unknown | undefined> {
  const d = isDemo();
  if (path[0] === "meta" && path.length === 1)
    return d ? demo.demoMeta() : live.getMeta();
  if (path[0] === "deployments" && path.length === 2) {
    const id = idSchema.parse(path[1]);
    return d ? demo.demoDeploymentDetail(id) : live.getDeploymentDetail(id);
  }
  if (path[0] === "servers" && path.length === 2) {
    const id = idSchema.parse(path[1]);
    return d ? demo.demoServerDetail(id) : live.getServerDetail(id);
  }
  if (path[0] === "dns" && path.length === 2) {
    const host = hostnameSchema.parse(path[1]);
    return d ? demo.demoDns(host) : checkDns(host);
  }
  if (path[0] === "resources" && path.length === 4) {
    const { kind, id } = target(path);
    switch (path[3]) {
      case "domains":
        if (kind !== "app")
          throw new Error("Domains are managed per application.");
        return d ? demo.demoDomainSettings(id) : getDomainSettings(id);
      case "config":
        return d ? demo.demoConfig(kind, id) : live.getConfig(kind, id);
      case "envs":
        return {
          envs: d ? demo.demoEnvs(kind, id) : await live.listEnvs(kind, id),
        };
      case "storages":
        return {
          storages: d
            ? demo.demoStorages(kind, id)
            : await live.listStorages(kind, id),
        };
      case "tasks":
        return {
          tasks: d ? demo.demoTasks(kind, id) : await live.listTasks(kind, id),
        };
      case "rollback":
        if (kind !== "app")
          throw new Error("Rollback is available for applications.");
        return d ? demo.demoRollbackImages(id) : live.getRollbackImages(id);
    }
  }
  return undefined;
}

export async function managePost(
  path: string[],
  body: () => Promise<unknown>,
): Promise<unknown | undefined> {
  const d = isDemo();
  if (path[0] === "resources" && path[1] === "create" && path.length === 2) {
    const input = createInputSchema.parse(await body());
    if (d) return { ok: true, ...demo.demoCreate(input) };
    const created = await live.createResource(input);
    let deploymentId: string | undefined;
    // Coolify's instant_deploy queues the first deployment; look it up so the UI can follow it.
    if (created.kind === "app" && input.instantDeploy)
      deploymentId = await live
        .latestDeploymentId(created.id)
        .catch(() => undefined);
    return { ok: true, ...created, deploymentId };
  }
  if (path[0] === "resources" && path.length === 4) {
    const { kind, id } = target(path);
    switch (path[3]) {
      case "domains": {
        if (kind !== "app")
          throw new Error("Domains are managed per application.");
        const input = domainInputSchema.parse(await body());
        const hosts = input.domains.map((x) => `${x.host}${x.port}${x.path}`);
        if (new Set(hosts).size !== hosts.length)
          throw new Error("Each domain can only be added once.");
        if (d) demo.demoUpdateDomains(id, input);
        else await updateDomains(id, input);
        return { ok: true };
      }
      case "config": {
        const input = configUpdateSchema.parse(await body());
        const allowed = editableKeys(kind);
        for (const field of Object.keys(input.fields))
          if (!allowed.has(field))
            throw new Error(`Field ${field} cannot be changed here.`);
        if (d) demo.demoUpdateConfig(kind, id, input.fields);
        else await live.updateConfig(kind, id, input.fields);
        let deploymentId: string | undefined;
        if (input.redeploy) {
          if (d) {
            const resource = demoData.resources.find((r) => r.id === id);
            if (resource && kind !== "database")
              deploymentId = demo.demoDeploy(resource);
          } else if (kind === "database")
            await resourceAction(kind, id, "restart");
          else
            deploymentId = (await resourceAction(kind, id, "deploy"))
              .deploymentId;
        }
        return { ok: true, deploymentId };
      }
      case "envs": {
        const input = envInputSchema.parse(await body());
        if (d) demo.demoMutateEnv(kind, id, input);
        else await live.mutateEnv(kind, id, input);
        return { ok: true };
      }
      case "storages": {
        const input = storageInputSchema.parse(await body());
        if (d) demo.demoMutateStorage(kind, id, input);
        else await live.mutateStorage(kind, id, input);
        return { ok: true };
      }
      case "tasks": {
        const input = taskInputSchema.parse(await body());
        if (d) demo.demoMutateTask(kind, id, input);
        else await live.mutateTask(kind, id, input);
        return { ok: true };
      }
      case "rollback": {
        if (kind !== "app")
          throw new Error("Rollback is available for applications.");
        const { tag } = z
          .object({ tag: z.string().trim().min(1).max(128) })
          .parse(await body());
        if (d) {
          const resource = demoData.resources.find((r) => r.id === id);
          if (!resource) throw new Error("Resource not found.");
          return { ok: true, deploymentId: demo.demoDeploy(resource) };
        }
        await live.rollback(id, tag);
        return { ok: true };
      }
    }
  }
  if (path[0] === "deployments" && path[2] === "cancel" && path.length === 3) {
    const id = idSchema.parse(path[1]);
    if (d) demo.demoCancel(id);
    else await live.cancelDeployment(id);
    return { ok: true };
  }
  if (path[0] === "projects" && path.length === 1) {
    const input = projectInputSchema.parse(await body());
    if (d) demo.demoMutateProject(input);
    else await live.mutateProject(input);
    return { ok: true };
  }
  if (path[0] === "servers" && path[2] === "action" && path.length === 3) {
    const id = idSchema.parse(path[1]);
    const { action } = serverActionSchema.parse(await body());
    if (!d) await live.serverAction(id, action);
    return { ok: true, demo: d };
  }
  return undefined;
}
