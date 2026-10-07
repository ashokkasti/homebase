import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSuggestions,
  rootDomain,
  slugify,
} from "../lib/coolify/domain-suggestions";
import { matchContainers } from "../lib/coolify/containers";
import { containerNameSchema, terminalOpenSchema } from "../lib/schemas";
import type { Container } from "../lib/schemas";

test("root domains handle common second-level TLDs", () => {
  assert.equal(rootDomain("api.app.example.com"), "example.com");
  assert.equal(rootDomain("shop.example.co.uk"), "example.co.uk");
  assert.equal(rootDomain("localhost"), "");
  assert.equal(slugify("Planner API (v2)"), "planner-api-v2");
});

test("domain suggestions skip taken hosts and offer numbered fallbacks", () => {
  const taken = new Map([
    ["planner.example.com", "Old planner"],
    ["blog.mysite.dev", "Blog"],
  ]);
  const hosts = buildSuggestions(
    { name: "Planner", environment: "staging", project: "Homelab" },
    { wildcards: ["https://example.com"], ips: ["203.0.113.5"], taken },
  ).map((s) => s.host);
  assert.ok(!hosts.includes("planner.example.com"));
  assert.ok(hosts.includes("planner-staging.example.com"));
  assert.ok(hosts.includes("planner.mysite.dev"));
  assert.ok(hosts.includes("planner.203.0.113.5.sslip.io"));
  const crowded = buildSuggestions(
    { name: "Planner" },
    {
      wildcards: ["example.com"],
      ips: [],
      taken: new Map([["planner.example.com", "x"]]),
    },
  );
  assert.deepEqual(
    crowded.map((s) => s.host),
    ["planner-2.example.com"],
  );
});

test("containers are matched to resources and service components", () => {
  const base = {
    image: "",
    state: "running",
    status: "Up",
    running: true,
    serverId: "s",
    serverName: "S",
  };
  const containers: Container[] = [
    { ...base, id: "1", name: "abc123-104512334455" },
    { ...base, id: "2", name: "postgresql-svc9" },
    { ...base, id: "3", name: "n8n-svc9" },
    { ...base, id: "4", name: "unrelated" },
  ];
  assert.deepEqual(
    matchContainers(
      { id: "abc123", kind: "app", components: [] },
      containers,
    ).map((c) => c.name),
    ["abc123-104512334455"],
  );
  const service = matchContainers(
    {
      id: "svc9",
      kind: "service",
      components: [
        { name: "n8n", status: "running" },
        { name: "postgresql", status: "running" },
      ],
    },
    containers,
  );
  assert.deepEqual(
    service.map((c) => [c.name, c.component]),
    [
      ["n8n-svc9", "n8n"],
      ["postgresql-svc9", "postgresql"],
    ],
  );
});

test("terminal input rejects shell metacharacters in container names", () => {
  assert.equal(containerNameSchema.safeParse("app-123_x.y").success, true);
  for (const bad of ["a;rm -rf /", "$(id)", "-it", "a b", "a'b"])
    assert.equal(containerNameSchema.safeParse(bad).success, false, bad);
  assert.equal(
    terminalOpenSchema.safeParse({
      kind: "app",
      resourceId: "abc",
      container: "abc-1",
    }).success,
    true,
  );
});
