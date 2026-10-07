// Suggests hostnames that are free in Coolify: subdomains of each server's
// wildcard domain, of root domains already in use, and of sslip.io.
import { isIP } from "node:net";
import { coolifyRequest } from "./client";
import { checkDns, parseDomains } from "./domains";
import type { DomainSuggestion, DomainSuggestions } from "../schemas";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : {};
const str = (v: unknown) =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";

export type SuggestionInput = {
  name: string;
  environment?: string;
  project?: string;
};
export type SuggestionContext = {
  wildcards: string[];
  ips: string[];
  // host -> name of the resource using it
  taken: Map<string, string>;
};

export function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

const secondLevel = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);
const generated = /(^|\.)(sslip\.io|nip\.io|traefik\.me)$/;
export function rootDomain(host: string) {
  const labels = host.replace(/^\*\./, "").split(".");
  if (labels.length < 2 || isIP(host)) return "";
  const tld = labels.at(-1) ?? "";
  const sld = labels.at(-2) ?? "";
  const size = tld.length === 2 && secondLevel.has(sld) ? 3 : 2;
  return labels.length >= size ? labels.slice(-size).join(".") : "";
}

function wildcardHost(value: string) {
  try {
    const url = new URL(
      /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`,
    );
    return url.hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function buildSuggestions(
  input: SuggestionInput,
  context: SuggestionContext,
): Omit<DomainSuggestion, "dns">[] {
  const slug = slugify(input.name) || "app";
  const env = slugify(input.environment ?? "");
  const project = slugify(input.project ?? "");
  const labels = [
    slug,
    ...(env && !["production", "prod", "main"].includes(env)
      ? [`${slug}-${env}`]
      : []),
    ...(project && project !== slug && !slug.startsWith(project)
      ? [`${project}-${slug}`]
      : []),
  ];
  const wildcardBases = [
    ...new Set(context.wildcards.map(wildcardHost).filter(Boolean)),
  ];
  const roots = [
    ...new Set(
      [...context.taken.keys()]
        .filter((host) => !generated.test(host))
        .map(rootDomain)
        .filter(Boolean),
    ),
  ].filter(
    (root) => !wildcardBases.some((w) => w === root || w.endsWith(`.${root}`)),
  );
  const bases: { base: string; source: DomainSuggestion["source"] }[] = [
    ...wildcardBases.map((base) => ({ base, source: "wildcard" as const })),
    ...roots.map((base) => ({ base, source: "existing" as const })),
    ...context.ips
      .filter((ip) => isIP(ip) === 4)
      .map((ip) => ({ base: `${ip}.sslip.io`, source: "sslip" as const })),
  ];
  const seen = new Set<string>();
  const out: Omit<DomainSuggestion, "dns">[] = [];
  for (const { base, source } of bases) {
    const free = labels
      .map((label) => `${label}.${base}`)
      .filter((host) => !context.taken.has(host));
    // Everything obvious is taken: offer the next numbered name.
    if (free.length === 0)
      for (let n = 2; n < 20; n++) {
        const host = `${slug}-${n}.${base}`;
        if (!context.taken.has(host)) {
          free.push(host);
          break;
        }
      }
    for (const host of free.slice(0, source === "sslip" ? 1 : 3))
      if (!seen.has(host) && host.length <= 253) {
        seen.add(host);
        out.push({ host, source });
      }
  }
  return out;
}

const rank: Record<DomainSuggestion["dns"], number> = {
  ok: 0,
  proxied: 1,
  mismatch: 3,
  missing: 2,
  error: 4,
};
const sourceRank: Record<DomainSuggestion["source"], number> = {
  wildcard: 0,
  existing: 1,
  sslip: 2,
};
export async function resolveSuggestions(
  input: SuggestionInput,
  context: SuggestionContext,
  dns: (host: string) => Promise<DomainSuggestion["dns"]>,
): Promise<DomainSuggestions> {
  const candidates = buildSuggestions(input, context).slice(0, 12);
  const suggestions = await Promise.all(
    candidates.map(async (c) => ({
      ...c,
      dns: c.source === "sslip" ? ("ok" as const) : await dns(c.host),
    })),
  );
  suggestions.sort(
    (a, b) =>
      rank[a.dns] - rank[b.dns] || sourceRank[a.source] - sourceRank[b.source],
  );
  return { suggestions, taken: Object.fromEntries(context.taken) };
}

// Hosts in use across Coolify, excluding the resource being edited.
async function takenHosts(exclude?: string) {
  const taken = new Map<string, string>();
  const add = (fqdn: string, name: string) => {
    for (const d of parseDomains(fqdn, []))
      if (!taken.has(d.host)) taken.set(d.host, name);
  };
  const [apps, services] = await Promise.all([
    coolifyRequest("/applications").catch(() => []),
    coolifyRequest("/services").catch(() => []),
  ]);
  for (const app of Array.isArray(apps) ? apps.map(rec) : [])
    if (str(app.uuid) !== exclude)
      add(str(app.fqdn), str(app.name) || "an app");
  for (const service of Array.isArray(services) ? services.map(rec) : []) {
    if (str(service.uuid) === exclude) continue;
    const name = str(service.name) || "a service";
    add(str(service.fqdn), name);
    for (const c of [service.applications, service.databases].flatMap((x) =>
      Array.isArray(x) ? x.map(rec) : [],
    ))
      add(str(c.fqdn), name);
  }
  return taken;
}

export async function getDomainSuggestions(
  input: SuggestionInput & { resourceId?: string },
) {
  const servers = await coolifyRequest("/servers").then((v) =>
    Array.isArray(v) ? v.map(rec) : [],
  );
  const [details, taken] = await Promise.all([
    Promise.all(
      servers.map((s) =>
        str(rec(s.settings).wildcard_domain)
          ? Promise.resolve(s)
          : coolifyRequest(`/servers/${encodeURIComponent(str(s.uuid))}`)
              .then(rec)
              .catch(() => s),
      ),
    ),
    takenHosts(input.resourceId),
  ]);
  const ips = servers.map((s) => str(s.ip)).filter((ip) => isIP(ip));
  const context: SuggestionContext = {
    wildcards: details
      .map((s) => str(rec(s.settings).wildcard_domain))
      .filter(Boolean),
    ips,
    taken,
  };
  return resolveSuggestions(
    input,
    context,
    async (host) => (await checkDns(host, ips)).status,
  );
}
