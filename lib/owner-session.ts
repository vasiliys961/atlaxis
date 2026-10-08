const encoder = new TextEncoder();
const OWNER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

async function signature(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data))));
}

export function sessionSecret(): string {
  const secret = process.env.ATLAXIS_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("session_secret_required");
  return secret;
}

export async function createOwnerSession(id: string, secret: string, now = Date.now()): Promise<string> {
  if (!OWNER_ID.test(id)) throw new Error("invalid_owner_id");
  const payload = `v1.${id}.${now}`;
  return `${payload}.${await signature(payload, secret)}`;
}

export async function verifyOwnerSession(value: string | undefined, secret: string, now = Date.now()): Promise<string | null> {
  if (!value || value.length > 180) return null;
  const match = /^v1\.([0-9a-f-]{36})\.(\d{13})\.([0-9a-f]{64})$/i.exec(value);
  if (!match || !OWNER_ID.test(match[1])) return null;
  const issued = Number(match[2]);
  if (!Number.isSafeInteger(issued) || issued > now + 60_000 || now - issued > MAX_AGE_MS) return null;
  const expected = await signature(`v1.${match[1]}.${match[2]}`, secret);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ match[3].toLowerCase().charCodeAt(i);
  return difference === 0 ? match[1] : null;
}
