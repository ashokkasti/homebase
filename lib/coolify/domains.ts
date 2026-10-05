import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import { coolifyRequest } from "./client";
import type {
  DnsResult,
  Domain,
  DomainSettings,
  domainInputSchema,
} from "../schemas";

type DomainInput = z.infer<typeof domainInputSchema>;

export function parseDomains(fqdn: string, noindex: string[]): Domain[] {
  const hidden = new Set(noindex.map((d) => d.trim().toLowerCase()));
  return fqdn
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try {
        const url = new URL(
          /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`,
        );
        if (url.protocol !== "http:" && url.protocol !== "https:") return [];
        const host = url.hostname.toLowerCase();
        return [
          {
            url: value,
            host,
            scheme:
              url.protocol === "http:" ? ("http" as const) : ("https" as const),
            port: url.port,
            path: url.pathname === "/" ? "" : url.pathname,
            indexed: !hidden.has(value.toLowerCase()) && !hidden.has(host),
          },
        ];
      } catch {
        return [];
      }
    });
}
export function domainUrl(d: DomainInput["domains"][number]) {
  return `${d.scheme}://${d.host}${d.port ? `:${d.port}` : ""}${d.path}`;
}

const str = (v: unknown) =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";
async function serverIps() {
  const servers = await coolifyRequest("/servers").catch(() => []);
  return Array.isArray(servers)
    ? servers
        .map((s) => str((s as Record<string, unknown>).ip))
        .filter((ip) => isIP(ip))
    : [];
}

export async function getDomainSettings(id: string): Promise<DomainSettings> {
  const [raw, ips] = await Promise.all([
    coolifyRequest(`/applications/${encodeURIComponent(id)}`),
    serverIps(),
  ]);
  const app = (raw ?? {}) as Record<string, unknown>;
  const settings = (app.settings ?? {}) as Record<string, unknown>;
  const noindex = Array.isArray(app.noindex_domains)
    ? app.noindex_domains.map(str)
    : [];
  const redirect = str(app.redirect);
  return {
    domains: parseDomains(str(app.fqdn), noindex),
    forceHttps:
      (app.is_force_https_enabled ?? settings.is_force_https_enabled) !== false,
    redirect: redirect === "www" || redirect === "non-www" ? redirect : "both",
    defaultPort: str(app.ports_exposes).split(",")[0] ?? "",
    serverIps: ips,
    compose: str(app.build_pack) === "dockercompose",
  };
}

export async function updateDomains(id: string, input: DomainInput) {
  const urls = input.domains.map(domainUrl);
  await coolifyRequest(
    `/applications/${encodeURIComponent(id)}`,
    "PATCH",
    undefined,
    {
      domains: urls.join(","),
      noindex_domains: input.domains.filter((d) => !d.indexed).map(domainUrl),
      is_force_https_enabled: input.forceHttps,
      redirect: input.redirect,
    },
  );
}

// Cloudflare proxy ranges (https://www.cloudflare.com/ips-v4). A proxied record
// hides the origin, so it cannot be compared with the server address.
const cloudflare = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];
function toInt(ip: string) {
  return ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}
export function isCloudflare(ip: string) {
  if (isIP(ip) !== 4) return false;
  const value = toInt(ip);
  return cloudflare.some((range) => {
    const [base = "", bits = "32"] = range.split("/");
    const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return (value & mask) === (toInt(base) & mask);
  });
}
export function classify(
  host: string,
  addresses: string[],
  cname: string[],
  ips: string[],
): DnsResult {
  const status: DnsResult["status"] =
    addresses.length === 0
      ? "missing"
      : addresses.some((a) => ips.includes(a))
        ? "ok"
        : addresses.every(isCloudflare) ||
            cname.some((c) => c.endsWith("cfargotunnel.com"))
          ? "proxied"
          : "mismatch";
  return { host, status, addresses, cname, serverIps: ips };
}
export async function checkDns(
  host: string,
  ips?: string[],
): Promise<DnsResult> {
  const resolver = new Resolver({ timeout: 3000, tries: 1 });
  const lookupHost = host.replace(/^\*\./, "wildcard-check.");
  const [v4, v6, cname, known] = await Promise.all([
    resolver.resolve4(lookupHost).catch(() => [] as string[]),
    resolver.resolve6(lookupHost).catch(() => [] as string[]),
    resolver.resolveCname(lookupHost).catch(() => [] as string[]),
    ips ? Promise.resolve(ips) : serverIps(),
  ]);
  return classify(host, [...v4, ...v6], cname, known);
}
