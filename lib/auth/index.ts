import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { isDemo } from "../demo";
const cookieName = "homebase-session";
function secret() {
  const value = process.env.HOMEBASE_SESSION_SECRET;
  if (!value || value.length < 32)
    throw new Error(
      "Configure HOMEBASE_SESSION_SECRET with at least 32 characters.",
    );
  return value;
}
export function loginConfigurationError() {
  const email = process.env.HOMEBASE_ADMIN_EMAIL?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return "Set HOMEBASE_ADMIN_EMAIL to the administrator email.";

  const hash = process.env.HOMEBASE_PASSWORD_HASH;
  if (!hash)
    return "Set HOMEBASE_PASSWORD_HASH. Generate it with npm exec tsx scripts/hash-password.ts 'your password'.";

  const [salt, digest, ...extra] = hash.split(":");
  if (
    extra.length > 0 ||
    !salt ||
    !/^[a-f0-9]{32}$/i.test(salt) ||
    !digest ||
    !/^[a-f0-9]{128}$/i.test(digest)
  )
    return "HOMEBASE_PASSWORD_HASH has an invalid format. Regenerate it with npm exec tsx scripts/hash-password.ts 'your password'.";

  const secret = process.env.HOMEBASE_SESSION_SECRET;
  if (!secret || secret.length < 32)
    return "Set HOMEBASE_SESSION_SECRET to at least 32 random characters.";

  return null;
}
export function verifyPassword(password: string) {
  const hash = process.env.HOMEBASE_PASSWORD_HASH;
  if (!hash) return false;
  const [salt, expected] = hash.split(":");
  if (!salt || !expected || !/^[a-f0-9]{128}$/.test(expected)) return false;
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}
export function signSession() {
  const payload = Buffer.from(
    JSON.stringify({
      expires: Date.now() + 86400000,
      nonce: randomBytes(24).toString("hex"),
    }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", secret()).update(payload).digest("base64url")}`;
}
export function validSession(token: string) {
  try {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return false;
    const expected = createHmac("sha256", secret()).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return false;
    const data: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    );
    return (
      typeof data === "object" &&
      data !== null &&
      "expires" in data &&
      typeof data.expires === "number" &&
      data.expires > Date.now()
    );
  } catch {
    return false;
  }
}
export async function authorized() {
  if (isDemo()) return true;
  const jar = await cookies();
  return validSession(jar.get(cookieName)?.value ?? "");
}
export async function setSession() {
  const jar = await cookies();
  jar.set(cookieName, signSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 86400,
  });
}
export async function clearSession() {
  (await cookies()).delete(cookieName);
}
// Same-origin check for mutations. Behind a TLS-terminating proxy (Traefik on
// Coolify, Caddy, nginx) the app sees plain http, so the proxy's forwarded
// scheme and host describe what the browser actually used. Browsers cannot set
// these headers cross-site without a CORS preflight, which this API never grants.
export function allowedOrigins(request: Request) {
  const requestUrl = new URL(request.url);
  const first = (value: string | null) => value?.split(",")[0]?.trim() || "";
  const host =
    first(request.headers.get("x-forwarded-host")) ||
    request.headers.get("host") ||
    requestUrl.host;
  const scheme =
    first(request.headers.get("x-forwarded-proto")) ||
    requestUrl.protocol.replace(":", "");
  const allowed = new Set([`${scheme}://${host}`, requestUrl.origin]);
  // HOMEBASE_URL may list several public addresses, separated by commas.
  for (const value of (process.env.HOMEBASE_URL ?? "").split(",")) {
    try {
      if (value.trim()) allowed.add(new URL(value.trim()).origin);
    } catch {
      // Ignore malformed entries rather than locking everyone out.
    }
  }
  return allowed;
}
export function verifyOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins(request).has(origin))
    throw new Error("Invalid request origin.");
  return origin;
}

const limits = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, max = 15) {
  const now = Date.now();
  if (limits.size > 10000) {
    for (const [k, v] of limits) if (v.reset < now) limits.delete(k);
  }
  const entry = limits.get(key);
  if (!entry || entry.reset < now) {
    limits.set(key, { count: 1, reset: now + 60000 });
    return;
  }
  if (entry.count >= max)
    throw new Error("Too many requests. Try again in a minute.");
  entry.count++;
}
