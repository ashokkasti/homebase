// Passkeys (WebAuthn) let the administrator sign in with Face ID, Touch ID,
// a fingerprint or a security key instead of the password. Registering one
// requires an existing session, so a passkey never replaces the password setup.
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { z } from "zod";
import { dataFolder } from "../coolify/config";
import { isDemo } from "../demo";
import { allowedOrigins } from ".";

const storedSchema = z.object({
  id: z.string(),
  publicKey: z.string(),
  counter: z.number(),
  transports: z.array(z.string()).optional(),
  name: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
type Stored = z.infer<typeof storedSchema>;
export type PasskeySummary = Pick<
  Stored,
  "id" | "name" | "createdAt" | "lastUsedAt"
>;

// The file is signed with the session secret so a passkey cannot be slipped
// in by editing the data directory alone.
const file = () => join(dataFolder(), "passkeys.json");
const demoStore: Stored[] = [];
function sign(body: string) {
  return createHmac("sha256", process.env.HOMEBASE_SESSION_SECRET ?? "")
    .update(`passkeys:${body}`)
    .digest("hex");
}
async function load(): Promise<Stored[]> {
  if (isDemo()) return demoStore;
  try {
    const raw = z
      .object({ body: z.string(), signature: z.string() })
      .parse(JSON.parse(await readFile(file(), "utf8")));
    const expected = Buffer.from(sign(raw.body), "hex");
    const actual = Buffer.from(raw.signature, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error(
        "Saved passkeys failed verification. Register them again.",
      );
    return z.array(storedSchema).parse(JSON.parse(raw.body));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
}
async function save(list: Stored[]) {
  if (isDemo()) {
    demoStore.splice(0, demoStore.length, ...list);
    return;
  }
  const body = JSON.stringify(list);
  await mkdir(dataFolder(), { recursive: true, mode: 0o700 });
  const temp = join(
    dataFolder(),
    `passkeys-${randomBytes(8).toString("hex")}.tmp`,
  );
  await writeFile(temp, JSON.stringify({ body, signature: sign(body) }), {
    mode: 0o600,
  });
  await rename(temp, file());
}

export async function listPasskeys(): Promise<PasskeySummary[]> {
  return (await load()).map(({ id, name, createdAt, lastUsedAt }) => ({
    id,
    name,
    createdAt,
    lastUsedAt,
  }));
}
export async function hasPasskeys() {
  try {
    return (await load()).length > 0;
  } catch {
    return false;
  }
}

// Challenges are single-use and expire after five minutes.
const challenges = new Map<string, { purpose: string; expires: number }>();
function remember(challenge: string, purpose: "register" | "login") {
  const now = Date.now();
  for (const [key, value] of challenges)
    if (value.expires < now) challenges.delete(key);
  if (challenges.size > 1000)
    throw new Error("Too many requests. Try again in a minute.");
  challenges.set(challenge, { purpose, expires: now + 300000 });
}
function consume(purpose: string) {
  return (challenge: string) => {
    const entry = challenges.get(challenge);
    challenges.delete(challenge);
    return !!entry && entry.purpose === purpose && entry.expires > Date.now();
  };
}

function relyingParty(request: Request) {
  const origins = [...allowedOrigins(request)];
  return {
    origins,
    ids: [...new Set(origins.map((origin) => new URL(origin).hostname))],
  };
}
// The browser shows this rpID; it must match the address the admin uses.
function primaryRpId(request: Request) {
  const origin = request.headers.get("origin");
  const { ids } = relyingParty(request);
  const id = origin ? new URL(origin).hostname : ids[0];
  if (!id || !ids.includes(id)) throw new Error("Invalid request origin.");
  return id;
}
function admin() {
  const email =
    process.env.HOMEBASE_ADMIN_EMAIL?.trim().toLowerCase() || "admin";
  return {
    email,
    userID: new Uint8Array(
      createHash("sha256").update(`homebase:${email}`).digest(),
    ),
  };
}

export async function registrationOptions(request: Request) {
  const list = await load();
  const user = admin();
  const options = await generateRegistrationOptions({
    rpName: "Homebase",
    rpID: primaryRpId(request),
    userName: user.email,
    userDisplayName: user.email,
    userID: user.userID,
    attestationType: "none",
    excludeCredentials: list.map((c) => ({
      id: c.id,
      transports: c.transports,
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  });
  remember(options.challenge, "register");
  return options;
}

export async function registerPasskey(
  request: Request,
  input: { response: RegistrationResponseJSON; name: string },
) {
  const rp = relyingParty(request);
  const result = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: consume("register"),
    expectedOrigin: rp.origins,
    expectedRPID: rp.ids,
    requireUserVerification: true,
  });
  if (!result.verified) throw new Error("The passkey could not be verified.");
  const { credential } = result.registrationInfo;
  const list = await load();
  if (list.some((c) => c.id === credential.id))
    throw new Error("This passkey is already registered.");
  if (list.length >= 20)
    throw new Error("Remove a passkey before adding another.");
  list.push({
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports,
    name: input.name.trim() || "Passkey",
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  });
  await save(list);
}

export async function removePasskey(id: string) {
  const list = await load();
  const next = list.filter((c) => c.id !== id);
  if (next.length === list.length) throw new Error("Passkey not found.");
  await save(next);
}

export async function loginOptions(request: Request) {
  const list = await load();
  if (list.length === 0) throw new Error("No passkeys are registered yet.");
  const options = await generateAuthenticationOptions({
    rpID: primaryRpId(request),
    // Discoverable credentials: the device offers its own passkey.
    allowCredentials: [],
    userVerification: "required",
  });
  remember(options.challenge, "login");
  return options;
}

export async function verifyPasskeyLogin(
  request: Request,
  response: AuthenticationResponseJSON,
) {
  const list = await load();
  const stored = list.find((c) => c.id === response.id);
  if (!stored) throw new Error("This passkey is not registered with Homebase.");
  const rp = relyingParty(request);
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: consume("login"),
    expectedOrigin: rp.origins,
    expectedRPID: rp.ids,
    requireUserVerification: true,
    credential: {
      id: stored.id,
      publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
      counter: stored.counter,
      transports: stored.transports,
    },
  });
  if (!result.verified) throw new Error("Passkey sign-in failed.");
  stored.counter = result.authenticationInfo.newCounter;
  stored.lastUsedAt = new Date().toISOString();
  await save(list);
}
