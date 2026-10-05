import { z } from "zod";
import { coolifyRequest } from "./client";
const raw = z.object({
  uuid: z.string(),
  name: z.string(),
  ip: z.string().nullish(),
  settings: z
    .object({
      is_reachable: z.boolean().nullish(),
      is_usable: z.boolean().nullish(),
    })
    .nullish(),
});
export async function getServers() {
  return z
    .array(raw)
    .parse(await coolifyRequest("/servers"))
    .map((s) => ({
      id: s.uuid,
      name: s.name,
      online: s.settings?.is_reachable ?? null,
      ip: s.ip ?? "",
      os: "",
      cpu: null,
      memory: null,
      memoryTotal: null,
      storage: null,
      storageTotal: null,
    }));
}
