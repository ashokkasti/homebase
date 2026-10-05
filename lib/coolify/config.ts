import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { connectionSchema } from "../schemas";
function dataFolder() {
  return process.env.HOMEBASE_DATA_DIR || join(process.cwd(), ".homebase");
}
function key() {
  const raw = process.env.HOMEBASE_ENCRYPTION_KEY;
  if (!raw || !/^[a-f0-9]{64}$/i.test(raw))
    throw new Error(
      "Configure HOMEBASE_ENCRYPTION_KEY with 64 hex characters.",
    );
  return Buffer.from(raw, "hex");
}
export async function getConfig() {
  // Coolify injects its own COOLIFY_URL (the app's URL) into containers it runs,
  // so the HOMEBASE_-prefixed names win when Homebase is hosted on Coolify.
  const url = process.env.HOMEBASE_COOLIFY_URL || process.env.COOLIFY_URL;
  const token = process.env.HOMEBASE_COOLIFY_TOKEN || process.env.COOLIFY_TOKEN;
  if (url && token) return connectionSchema.parse({ url, token });
  try {
    const value = await readFile(join(dataFolder(), "connection.enc"), "utf8");
    const [iv, tag, encrypted] = value.split(".");
    if (!iv || !tag || !encrypted) throw new Error("Invalid saved connection.");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(iv, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    return connectionSchema.parse(
      JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(encrypted, "hex")),
          decipher.final(),
        ]).toString(),
      ),
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}
export async function saveConfig(input: unknown) {
  const config = connectionSchema.parse(input);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(config)),
    cipher.final(),
  ]);
  await mkdir(dataFolder(), { recursive: true, mode: 0o700 });
  const temp = join(
    dataFolder(),
    `connection-${randomBytes(8).toString("hex")}.tmp`,
  );
  await writeFile(
    temp,
    `${iv.toString("hex")}.${cipher.getAuthTag().toString("hex")}.${encrypted.toString("hex")}`,
    { mode: 0o600 },
  );
  await rename(temp, join(dataFolder(), "connection.enc"));
}
