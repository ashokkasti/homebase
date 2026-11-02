// SSH access to Coolify servers, using the private keys Coolify already holds.
// The Coolify API has no container or terminal endpoints, so Homebase does what
// Coolify itself does: SSH to the server and talk to Docker there.
import { Client, type ClientChannel } from "ssh2";
import { coolifyRequest } from "./client";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : {};
const str = (v: unknown) =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";

type Target = {
  id: string;
  hosts: string[];
  port: number;
  user: string;
  keys: string[];
};

// Coolify registers its own host as host.docker.internal. Homebase may run in
// a container without that alias, so fall back to the usual Docker gateways.
function hostsFor(ip: string) {
  if (ip !== "host.docker.internal" && ip !== "localhost" && ip !== "127.0.0.1")
    return [ip];
  return [
    ...(process.env.HOMEBASE_SSH_LOCAL_HOST
      ? [process.env.HOMEBASE_SSH_LOCAL_HOST]
      : []),
    "host.docker.internal",
    "10.0.0.1",
    "172.17.0.1",
    "127.0.0.1",
  ];
}

async function target(serverId: string): Promise<Target> {
  const [server, keys] = await Promise.all([
    coolifyRequest(`/servers/${encodeURIComponent(serverId)}`).then(rec),
    coolifyRequest("/security/keys").then((v) =>
      Array.isArray(v) ? v.map(rec) : [],
    ),
  ]);
  const ip = str(server.ip);
  if (!ip)
    throw new Error("Coolify did not return an address for this server.");
  const keyId = str(server.private_key_id);
  const usable = keys.filter((k) => str(k.private_key).includes("PRIVATE KEY"));
  if (usable.length === 0)
    throw new Error(
      "Coolify did not return any private keys. The API token needs read:sensitive.",
    );
  // Prefer the server's own key; otherwise try non-git keys first.
  const ordered = [
    ...usable.filter((k) => keyId && str(k.id) === keyId),
    ...usable.filter(
      (k) => !(keyId && str(k.id) === keyId) && !k.is_git_related,
    ),
    ...usable.filter(
      (k) => !(keyId && str(k.id) === keyId) && k.is_git_related,
    ),
  ];
  return {
    id: serverId,
    hosts: hostsFor(ip),
    port: Number(str(server.port)) || 22,
    user: str(server.user) || "root",
    keys: ordered.map((k) => str(k.private_key)),
  };
}

function open(host: string, t: Target, key: string) {
  return new Promise<Client>((resolve, reject) => {
    const client = new Client();
    client
      .once("ready", () => resolve(client))
      .once("error", (error) => {
        client.end();
        reject(error);
      })
      .connect({
        host,
        port: t.port,
        username: t.user,
        privateKey: key,
        readyTimeout: 8000,
        keepaliveInterval: 15000,
      });
  });
}

// Non-root Coolify servers run Docker through passwordless sudo.
type Pooled = {
  client: Client;
  docker: string;
  privileged: string;
  timer?: NodeJS.Timeout;
  users: number;
};
// Builds the remote command from the server's docker invocation.
type Command = (docker: string, privileged: string) => string;
const store = globalThis as typeof globalThis & {
  homebaseSsh?: Map<string, Promise<Pooled>>;
};
const pool = (store.homebaseSsh ??= new Map());

async function dial(serverId: string): Promise<Pooled> {
  const t = await target(serverId);
  let last: unknown;
  for (const host of t.hosts)
    for (const key of t.keys) {
      try {
        const client = await open(host, t, key);
        const pooled: Pooled = {
          client,
          docker: t.user === "root" ? "docker" : "sudo -n docker",
          privileged: t.user === "root" ? "" : "sudo -n ",
          users: 0,
        };
        const drop = () => pool.delete(serverId);
        client.once("close", drop).once("end", drop);
        return pooled;
      } catch (error) {
        last = error;
        // Unreachable host: skip its remaining keys.
        if (error instanceof Error && !/authentication/i.test(error.message))
          break;
      }
    }
  throw new Error(
    `Could not SSH to the server (${last instanceof Error ? last.message : "connection failed"}).`,
  );
}

// One shared connection per server. Idle connections close after a minute.
async function acquire(serverId: string) {
  let entry = pool.get(serverId);
  if (!entry) {
    entry = dial(serverId);
    pool.set(serverId, entry);
    entry.catch(() => pool.delete(serverId));
  }
  const pooled = await entry;
  clearTimeout(pooled.timer);
  pooled.users++;
  return {
    client: pooled.client,
    docker: pooled.docker,
    privileged: pooled.privileged,
    release() {
      pooled.users--;
      if (pooled.users > 0) return;
      pooled.timer = setTimeout(() => {
        pool.delete(serverId);
        pooled.client.end();
      }, 60000);
    },
  };
}

export async function sshExec(
  serverId: string,
  command: Command,
  options: { input?: string; timeoutMs?: number } = {},
) {
  const { client, docker, privileged, release } = await acquire(serverId);
  try {
    return await new Promise<string>((resolve, reject) => {
      client.exec(
        command(docker, privileged),
        (error: Error | undefined, stream: ClientChannel) => {
          if (error) return reject(error);
          let out = "";
          let err = "";
          const timer = setTimeout(() => {
            stream.close();
            reject(new Error("The server took too long to answer."));
          }, options.timeoutMs ?? 15000);
          let bytes = 0;
          stream
            .on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > 4 * 1024 * 1024) {
                stream.close();
                reject(new Error("Server response exceeded the output limit."));
                return;
              }
              out += chunk.toString();
            })
            .on("close", (code: number | null) => {
              clearTimeout(timer);
              if (code !== 0)
                reject(
                  new Error(err.trim().slice(0, 300) || `Exit code ${code}`),
                );
              else resolve(out);
            });
          if (options.input !== undefined) stream.end(options.input);
          stream.stderr.on(
            "data",
            (chunk: Buffer) => (err += chunk.toString()),
          );
        },
      );
    });
  } finally {
    release();
  }
}

export async function sshShell(
  serverId: string,
  command: Command,
  size: { cols: number; rows: number },
): Promise<ClientChannel> {
  const { client, docker, privileged, release } = await acquire(serverId);
  return new Promise((resolve, reject) => {
    client.exec(
      command(docker, privileged),
      { pty: { term: "xterm-256color", cols: size.cols, rows: size.rows } },
      (error: Error | undefined, stream: ClientChannel) => {
        if (error) {
          release();
          return reject(error);
        }
        stream.once("close", release);
        resolve(stream);
      },
    );
  });
}
