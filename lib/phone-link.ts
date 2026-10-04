import { randomBytes } from "crypto";
import { readText, writeText } from "./files";

const TTL_MS = 2 * 60 * 60 * 1000;
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

type PhoneLink = {
  code: string;
  ownerId: string;
  expiresAt: number;
};

type PhoneFile = {
  links: PhoneLink[];
};

const LINKS_KEY = "_phone/links.json";
let chain: Promise<unknown> = Promise.resolve();

function code(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

async function readLinks(): Promise<PhoneLink[]> {
  try {
    const raw = await readText(LINKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PhoneFile;
    return Array.isArray(parsed.links) ? parsed.links : [];
  } catch {
    return [];
  }
}

async function writeLinks(links: PhoneLink[]): Promise<void> {
  await writeText(LINKS_KEY, JSON.stringify({ links }));
}

function fresh(links: PhoneLink[]): PhoneLink[] {
  const now = Date.now();
  return links.filter((link) => link.expiresAt > now);
}

function locked<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

export function createPhoneLink(ownerId: string): Promise<{ code: string; expiresAt: string }> {
  return locked(async () => {
    const links = fresh(await readLinks());
    const existing = links.find((link) => link.ownerId === ownerId);
    if (existing) {
      await writeLinks(links);
      return { code: existing.code, expiresAt: new Date(existing.expiresAt).toISOString() };
    }
    const link: PhoneLink = { code: code(), ownerId, expiresAt: Date.now() + TTL_MS };
    links.push(link);
    await writeLinks(links);
    return { code: link.code, expiresAt: new Date(link.expiresAt).toISOString() };
  });
}

export function ownerForCode(value: string): Promise<string | null> {
  return locked(async () => {
    const links = fresh(await readLinks());
    await writeLinks(links);
    return links.find((link) => link.code === value)?.ownerId ?? null;
  });
}

export function dropPhoneLinks(ownerId: string): Promise<void> {
  return locked(async () => {
    const links = fresh(await readLinks()).filter((link) => link.ownerId !== ownerId);
    await writeLinks(links);
  });
}
