import assert from "node:assert/strict";
import { dashboardSchema } from "../lib/schemas";
const base = process.argv[2] || "http://localhost:3000";
const origin = new URL(base).origin;
async function request(path: string, body?: unknown, requestOrigin = origin) {
  return fetch(`${base}/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? undefined
        : { "Content-Type": "application/json", Origin: requestOrigin },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function main() {
  const dashboardResponse = await request("dashboard");
  assert.equal(dashboardResponse.status, 200);
  const dashboard = dashboardSchema.parse(await dashboardResponse.json());
  assert.equal(
    dashboard.demo,
    true,
    "This smoke test runs only against a demo workspace.",
  );
  const app = dashboard.resources.find((r) => r.kind === "app");
  assert.ok(app, "A demo application is required.");
  const actionPath = `resources/${encodeURIComponent(app.id)}/action`;
  assert.equal(
    (await request(actionPath, { action: "stop" })).status,
    400,
    "Stop requires confirmation.",
  );
  assert.equal(
    (
      await request(
        actionPath,
        { action: "stop", confirmation: app.name },
        "https://invalid-origin.test",
      )
    ).status,
    400,
    "Cross-origin mutations must fail.",
  );
  assert.equal(
    (await request(actionPath, { action: "stop", confirmation: app.name }))
      .status,
    200,
  );
  let state = dashboardSchema.parse(await (await request("dashboard")).json());
  assert.equal(state.resources.find((r) => r.id === app.id)?.status, "stopped");
  assert.equal((await request(actionPath, { action: "deploy" })).status, 200);
  state = dashboardSchema.parse(await (await request("dashboard")).json());
  assert.equal(
    state.resources.find((r) => r.id === app.id)?.status,
    "deploying",
  );
  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    state = dashboardSchema.parse(await (await request("dashboard")).json());
    if (state.resources.find((r) => r.id === app.id)?.status === "running")
      break;
  }
  assert.equal(state.resources.find((r) => r.id === app.id)?.status, "running");
  assert.equal(state.deployments[0]?.status, "successful");
  const logs = await request(
    `logs?id=${encodeURIComponent(state.deployments[0]?.id ?? "")}&type=deployment`,
  );
  assert.equal(logs.status, 200);
  assert.match(JSON.stringify(await logs.json()), /Rolling update completed/);
  const detail = await request(
    `deployments/${encodeURIComponent(state.deployments[0]?.id ?? "")}`,
  );
  assert.equal(detail.status, 200);
  assert.equal(
    ((await detail.json()) as { status: string }).status,
    "successful",
  );
  const envPath = `resources/app/${encodeURIComponent(app.id)}/envs`;
  assert.equal(
    (await request(envPath, { op: "create", key: "SMOKE_KEY", value: "1" }))
      .status,
    200,
  );
  assert.equal(
    (await request(envPath, { op: "create", key: "bad key", value: "1" }))
      .status,
    400,
    "Invalid env keys are rejected.",
  );
  const envs = (await (await request(envPath)).json()) as {
    envs: { id: string; key: string }[];
  };
  const created = envs.envs.find((e) => e.key === "SMOKE_KEY");
  assert.ok(created, "Created env var is listed.");
  assert.equal(
    (await request(envPath, { op: "delete", id: created.id })).status,
    200,
  );
  assert.equal(
    (await request(`resources/app/..%2Fservers/config`)).status,
    400,
    "Path-like identifiers are rejected.",
  );
  const configPath = `resources/app/${encodeURIComponent(app.id)}/config`;
  assert.equal(
    (await request(configPath, { fields: { webhook_secret: "x" } })).status,
    400,
    "Only whitelisted config fields can change.",
  );
  process.stdout.write(
    "Runtime smoke passed: confirmation, CSRF rejection, stop, deployment polling, completion, deployment logs, env CRUD, and input validation.\n",
  );
}
void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
