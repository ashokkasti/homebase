import test from "node:test";
import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  signSession,
  validSession,
  verifyPassword,
  verifyOrigin,
  rateLimit,
} from "../lib/auth";
import {
  normalizeStatus,
  safeUrl,
  coolifyRequest,
} from "../lib/coolify/client";
import { dashboardSchema } from "../lib/schemas";
import { demoData } from "../lib/demo";
import { saveConfig, getConfig } from "../lib/coolify/config";
import { createServer } from "node:http";
import { once } from "node:events";
test("status normalization distinguishes unhealthy from running", () => {
  assert.equal(normalizeStatus("running:healthy"), "running");
  assert.equal(normalizeStatus("running:unhealthy"), "failed");
  assert.equal(normalizeStatus("exited"), "stopped");
  assert.equal(normalizeStatus("starting"), "deploying");
  assert.equal(normalizeStatus(null), "unknown");
});
test("resource URLs reject executable schemes", () => {
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(
    safeUrl("https://example.com,http://second.test"),
    "https://example.com/",
  );
});
test("sessions reject tampering and missing secrets", () => {
  process.env.HOMEBASE_SESSION_SECRET =
    "test-secret-with-at-least-32-characters";
  const token = signSession();
  assert.equal(validSession(token), true);
  assert.equal(validSession(`${token}x`), false);
  assert.equal(validSession("broken"), false);
  const original = process.env.HOMEBASE_SESSION_SECRET;
  delete process.env.HOMEBASE_SESSION_SECRET;
  assert.equal(validSession(token), false);
  process.env.HOMEBASE_SESSION_SECRET = original;
});
test("password hashes compare verified scrypt output", () => {
  const salt = "test-salt";
  process.env.HOMEBASE_PASSWORD_HASH = `${salt}:${scryptSync("a secure password", salt, 64).toString("hex")}`;
  assert.equal(verifyPassword("a secure password"), true);
  assert.equal(verifyPassword("wrong password"), false);
  delete process.env.HOMEBASE_PASSWORD_HASH;
});
test("mutations enforce same origin and action rate limits", () => {
  assert.doesNotThrow(() =>
    verifyOrigin(
      new Request("https://home.test/api/action", {
        headers: { origin: "https://home.test" },
      }),
    ),
  );
  assert.throws(() =>
    verifyOrigin(
      new Request("https://home.test/api/action", {
        headers: { origin: "https://evil.test" },
      }),
    ),
  );
  assert.throws(() =>
    verifyOrigin(new Request("https://home.test/api/action")),
  );
  rateLimit("test-rate", 1);
  assert.throws(() => rateLimit("test-rate", 1));
});
test("demo data conforms to the browser API contract", () => {
  assert.equal(dashboardSchema.parse(demoData).resources.length, 11);
});
test("saved API credentials are encrypted and recoverable", async () => {
  const folder = await mkdtemp(join(tmpdir(), "homebase-test-"));
  process.env.HOMEBASE_ENCRYPTION_KEY = "a".repeat(64);
  process.env.HOMEBASE_DATA_DIR = folder;
  try {
    await saveConfig({
      url: "https://coolify.example.com",
      token: "secret-token-to-encrypt",
    });
    assert.equal((await getConfig())?.token, "secret-token-to-encrypt");
    const encrypted = await readFile(join(folder, "connection.enc"), "utf8");
    assert.equal(encrypted.includes("secret-token"), false);
  } finally {
    await rm(folder, { recursive: true, force: true });
    delete process.env.HOMEBASE_ENCRYPTION_KEY;
    delete process.env.HOMEBASE_DATA_DIR;
  }
});
test("Coolify transport uses bearer authentication and does not return upstream error bodies", async () => {
  let auth = "";
  const server = createServer((req, res) => {
    auth = req.headers.authorization ?? "";
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/v1/applications")
      res.end(JSON.stringify([{ uuid: "app-1", name: "Fixture application" }]));
    else {
      res.statusCode = 403;
      res.end(JSON.stringify({ password: "do not expose this" }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const config = {
    url: `http://127.0.0.1:${address.port}`,
    token: "fixture-secret-token",
  };
  try {
    assert.deepEqual(await coolifyRequest("/applications", "GET", config), [
      { uuid: "app-1", name: "Fixture application" },
    ]);
    assert.equal(auth, "Bearer fixture-secret-token");
    await assert.rejects(
      coolifyRequest("/forbidden", "GET", config),
      /rejected the API token/,
    );
  } finally {
    server.close();
  }
});

test("connected dashboard normalizes real HTTP fixture responses and strips secrets", async () => {
  const requests: { path: string; method: string }[] = [];
  const fixtures: Record<string, unknown> = {
    "/api/v1/projects": [{ uuid: "project-1" }],
    "/api/v1/projects/project-1/environments": [
      { id: 1, uuid: "production-1", name: "Production" },
    ],
    "/api/v1/applications": [
      {
        uuid: "app-1",
        name: "Test app",
        status: "running:healthy",
        fqdn: "https://app.test",
        environment_id: 1,
        git_branch: "main",
        password: "secret-app-password",
      },
    ],
    "/api/v1/databases": [
      {
        uuid: "db-1",
        name: "Test PostgreSQL",
        status: "running:healthy",
        environment_id: 1,
        postgres_password: "secret-db-password",
      },
    ],
    "/api/v1/services": [
      {
        uuid: "service-1",
        name: "Test service",
        status: "running:healthy",
        environment_id: 1,
        docker_compose_raw: "secret compose environment",
      },
    ],
    "/api/v1/services/service-1/applications": [
      { name: "Auth", status: "running:healthy", fqdn: "https://auth.test" },
    ],
    "/api/v1/services/service-1/databases": [
      { name: "Postgres", status: "running:healthy" },
    ],
    "/api/v1/servers": [
      {
        uuid: "server-1",
        name: "Fixture Server",
        ip: "192.168.0.3",
        settings: { is_reachable: true },
        private_key: "secret-ssh-key",
      },
    ],
    "/api/v1/deployments/applications/app-1?take=10": {
      deployments: [
        {
          deployment_uuid: "deploy-1",
          status: "finished",
          commit: "abcdef123",
          created_at: "2026-10-05T12:00:00Z",
          finished_at: "2026-10-05T12:00:48Z",
          commit_message: "Ship it",
          logs: "secret build config",
        },
      ],
    },
    "/api/v1/deploy?uuid=app-1": {
      deployments: [
        {
          resource_uuid: "app-1",
          deployment_uuid: "deploy-2",
          message: "Deployment queued",
        },
      ],
    },
    "/api/v1/applications/app-1/restart": {
      message: "Restart request queued.",
    },
  };
  const server = createServer((req, res) => {
    requests.push({ path: req.url ?? "", method: req.method ?? "" });
    res.setHeader("Content-Type", "application/json");
    const fixture = fixtures[req.url ?? ""];
    if (!fixture) {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    res.end(JSON.stringify(fixture));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  process.env.HOMEBASE_DEMO = "false";
  process.env.COOLIFY_URL = `http://127.0.0.1:${address.port}`;
  process.env.COOLIFY_TOKEN = "fixture-api-token";
  try {
    const { getDashboard } = await import("../lib/coolify/dashboard");
    const { resourceAction } = await import("../lib/coolify/resources");
    const dashboard = dashboardSchema.parse(await getDashboard());
    assert.equal(dashboard.connected, true);
    assert.equal(dashboard.resources.length, 3);
    assert.equal(dashboard.deployments[0]?.status, "successful");
    assert.equal(dashboard.deployments[0]?.duration, "48s");
    assert.equal(
      dashboard.resources[0]?.coolifyUrl,
      `${process.env.COOLIFY_URL}/project/project-1/environment/production-1/application/app-1`,
    );
    assert.equal(dashboard.resources[2]?.components.length, 2);
    assert.equal(dashboard.servers[0]?.cpu, null);
    assert.equal(dashboard.servers[0]?.online, true);
    assert.deepEqual(dashboard.warnings, []);
    assert.equal(JSON.stringify(dashboard).includes("secret"), false);
    assert.equal(
      JSON.stringify(dashboard).includes("fixture-api-token"),
      false,
    );
    await resourceAction("app", "app-1", "deploy");
    await resourceAction("app", "app-1", "restart");
    assert.ok(
      requests.some(
        (r) => r.path === "/api/v1/deploy?uuid=app-1" && r.method === "POST",
      ),
    );
    assert.ok(
      requests.some(
        (r) =>
          r.path === "/api/v1/applications/app-1/restart" &&
          r.method === "POST",
      ),
    );
  } finally {
    server.close();
    delete process.env.HOMEBASE_DEMO;
    delete process.env.COOLIFY_URL;
    delete process.env.COOLIFY_TOKEN;
  }
});

test("CSRF check accepts the browser host when Next.js uses a bind address", () => {
  assert.doesNotThrow(() =>
    verifyOrigin(
      new Request("http://0.0.0.0:3001/api/action", {
        headers: { host: "localhost:3001", origin: "http://localhost:3001" },
      }),
    ),
  );
  assert.throws(() =>
    verifyOrigin(
      new Request("http://0.0.0.0:3001/api/action", {
        headers: { host: "localhost:3001", origin: "https://evil.test" },
      }),
    ),
  );
});
test("CSRF check follows a TLS-terminating proxy and listed public URLs", () => {
  const proxied = (origin: string) =>
    new Request("http://10.0.1.5:3000/api/action", {
      headers: {
        host: "home.example.com",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "home.example.com",
        origin,
      },
    });
  assert.doesNotThrow(() => verifyOrigin(proxied("https://home.example.com")));
  assert.throws(() => verifyOrigin(proxied("https://evil.test")));
  assert.throws(() => verifyOrigin(proxied("http://evil.test")));
  process.env.HOMEBASE_URL =
    "https://home.example.com, https://alt.example.net";
  try {
    assert.doesNotThrow(() =>
      verifyOrigin(
        new Request("http://10.0.1.5:3000/api/action", {
          headers: { host: "10.0.1.5:3000", origin: "https://alt.example.net" },
        }),
      ),
    );
    assert.throws(() =>
      verifyOrigin(
        new Request("http://10.0.1.5:3000/api/action", {
          headers: { host: "10.0.1.5:3000", origin: "https://evil.test" },
        }),
      ),
    );
  } finally {
    delete process.env.HOMEBASE_URL;
  }
});
