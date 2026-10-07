"use client";
// Free hostnames for a resource, offered under domain inputs.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { domainSuggestionsSchema, type DomainSuggestion } from "@/lib/schemas";
import { Icon } from "./ui/icon";

const dnsHint: Record<DomainSuggestion["dns"], string> = {
  ok: "Already resolves to your server. Works right away.",
  proxied: "Behind Cloudflare. Should work if the proxy points here.",
  mismatch: "Resolves elsewhere. Update its DNS record first.",
  missing: "No DNS record yet. Add an A record pointing at your server.",
  error: "DNS lookup failed.",
};
const sourceLabel: Record<DomainSuggestion["source"], string> = {
  wildcard: "Server wildcard domain",
  existing: "A domain you already use",
  sslip: "sslip.io, resolves to your server IP with no setup",
};

function useDebounced<T>(value: T, ms: number) {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setCurrent(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return current;
}

export function DomainSuggestions({
  name,
  resourceId,
  environment,
  project,
  value = "",
  exclude = [],
  onPick,
}: {
  name: string;
  resourceId?: string;
  environment?: string;
  project?: string;
  // Hosts currently typed into the field, checked against other resources.
  value?: string | string[];
  // Hosts already on this resource.
  exclude?: string[];
  onPick: (host: string) => void;
}) {
  const label = useDebounced(name.trim(), 400);
  const query = useQuery({
    queryKey: ["domain-suggestions", label, resourceId, environment, project],
    queryFn: () => {
      const params = new URLSearchParams({ name: label });
      if (resourceId) params.set("resourceId", resourceId);
      if (environment) params.set("environment", environment);
      if (project) params.set("project", project);
      return api(`domains/suggest?${params}`, domainSuggestionsSchema);
    },
    enabled: label.length > 0,
    staleTime: 60000,
    placeholderData: (previous) => previous,
  });
  if (!label) return null;
  const typed = (Array.isArray(value) ? value : [value])
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  const conflicts = typed
    .map((host) => [host, query.data?.taken[host]] as const)
    .filter((entry): entry is readonly [string, string] => !!entry[1]);
  const skip = new Set([...exclude, ...typed]);
  const suggestions = (query.data?.suggestions ?? []).filter(
    (s) => !skip.has(s.host),
  );
  return (
    <div className="domain-suggestions">
      {conflicts.map(([host, owner]) => (
        <p className="domain-conflict" key={host}>
          <Icon name="danger" size={14} />
          <span>
            <b className="mono">{host}</b> is already used by {owner}.
          </span>
        </p>
      ))}
      {(suggestions.length > 0 || query.isFetching) && (
        <div className="suggestion-list" aria-label="Suggested domains">
          <span className="suggestion-label">
            <Icon
              name="magic"
              size={13}
              className={query.isFetching ? "spin" : ""}
            />
            Available
          </span>
          {suggestions.map((s) => (
            <button
              type="button"
              key={s.host}
              className={`suggestion-chip mono dns-${s.dns}`}
              title={`${sourceLabel[s.source]}\n${dnsHint[s.dns]}`}
              onClick={() => onPick(s.host)}
            >
              <span className="dot" />
              {s.host}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
