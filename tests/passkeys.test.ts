import test from "node:test";
import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isoCBOR } from "@simplewebauthn/server/helpers";

type CBOR = Parameters<typeof isoCBOR.encode>[0];
const origin = "https://home.example.com";
const b64 = (value: Buffer | Uint8Array) =>
  Buffer.from(value).toString("base64url");
function request() {
  return new Request(`${origin}/api/auth/passkey/options`, {
    method: "POST",
    headers: { origin, host: "home.example.com" },
  });
}

// A minimal software authenticator: ES256 key, "none" attestation.
function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const id = randomBytes(16);
  const cose = isoCBOR.encode(
    new Map<number, CBOR>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x ?? "", "base64url"))],
      [-3, new Uint8Array(Buffer.from(jwk.y ?? "", "base64url"))],
    ]),
  );
  let counter = 0;
  const rpHash = createHash("sha256").update("home.example.com").digest();
  const clientData = (type: string, challenge: string, from = origin) =>
    Buffer.from(JSON.stringify({ type, challenge, origin: from }));
  return {
    register(challenge: string) {
      const length = Buffer.alloc(2);
      length.writeUInt16BE(id.length);
      const authData = Buffer.concat([
        rpHash,
        Buffer.from([0x45]), // user present, user verified, attested data
        Buffer.alloc(4),
        Buffer.alloc(16),
        length,
        id,
        Buffer.from(cose),
      ]);
      const attestationObject = isoCBOR.encode(
        new Map<string, CBOR>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", new Uint8Array(authData)],
        ]),
      );
      return {
        id: b64(id),
        rawId: b64(id),
        type: "public-key" as const,
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64(clientData("webauthn.create", challenge)),
          attestationObject: b64(attestationObject),
          transports: ["internal" as const],
        },
      };
    },
    login(challenge: string, from = origin) {
      const count = Buffer.alloc(4);
      count.writeUInt32BE(++counter);
      const authData = Buffer.concat([rpHash, Buffer.from([0x05]), count]);
      const data = clientData("webauthn.get", challenge, from);
      const signature = sign(
        "sha256",
        Buffer.concat([authData, createHash("sha256").update(data).digest()]),
        privateKey,
      );
      return {
        id: b64(id),
        rawId: b64(id),
        type: "public-key" as const,
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64(data),
          authenticatorData: b64(authData),
          signature: b64(signature),
        },
      };
    },
  };
}

test("passkeys register, sign in once per challenge and reject tampering", async () => {
  const dir = await mkdtemp(join(tmpdir(), "homebase-passkeys-"));
  process.env.HOMEBASE_DEMO = "false";
  process.env.HOMEBASE_DATA_DIR = dir;
  process.env.HOMEBASE_SESSION_SECRET = "s".repeat(40);
  process.env.HOMEBASE_ADMIN_EMAIL = "admin@example.com";
  try {
    const keys = await import("../lib/auth/passkeys");
    assert.equal(await keys.hasPasskeys(), false);
    await assert.rejects(keys.loginOptions(request()), /No passkeys/);

    const device = authenticator();
    const registration = await keys.registrationOptions(request());
    assert.equal(registration.rp.id, "home.example.com");
    await keys.registerPasskey(request(), {
      response: device.register(registration.challenge),
      name: "iPhone",
    });
    assert.equal(await keys.hasPasskeys(), true);
    const [stored] = await keys.listPasskeys();
    assert.equal(stored?.name, "iPhone");

    const options = await keys.loginOptions(request());
    const assertion = device.login(options.challenge);
    await keys.verifyPasskeyLogin(request(), assertion);
    assert.ok((await keys.listPasskeys())[0]?.lastUsedAt);
    // A challenge works only once.
    await assert.rejects(keys.verifyPasskeyLogin(request(), assertion));
    // An assertion made on another site is refused.
    const other = await keys.loginOptions(request());
    await assert.rejects(
      keys.verifyPasskeyLogin(
        request(),
        device.login(other.challenge, "https://evil.example"),
      ),
    );

    // Editing the stored file invalidates it.
    const path = join(dir, "passkeys.json");
    const saved = JSON.parse(await readFile(path, "utf8")) as {
      body: string;
      signature: string;
    };
    await writeFile(
      path,
      JSON.stringify({ ...saved, body: saved.body.replace("iPhone", "Evil") }),
    );
    await assert.rejects(keys.listPasskeys(), /failed verification/);
    assert.equal(await keys.hasPasskeys(), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
