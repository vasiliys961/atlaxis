import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { dataRoot } from "./data-root";

export function useBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function localPath(key: string): string {
  return path.join(dataRoot(), key);
}

export async function readText(key: string): Promise<string | null> {
  if (!useBlob()) {
    try {
      return await readFile(localPath(key), "utf8");
    } catch {
      return null;
    }
  }
  const { get } = await import("@vercel/blob");
  const result = await get(key, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  return new Response(result.stream).text();
}

export async function writeText(key: string, text: string): Promise<void> {
  if (!useBlob()) {
    const file = localPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
    return;
  }
  const { put } = await import("@vercel/blob");
  await put(key, text, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function readBinary(key: string): Promise<Buffer | null> {
  try {
    return await readFile(localPath(key));
  } catch {
    // Файл мог остаться только в закрытом хранилище.
  }
  if (!useBlob()) return null;
  const { get } = await import("@vercel/blob");
  const result = await get(key, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

export async function writeBinary(key: string, bytes: Buffer): Promise<void> {
  if (!useBlob()) return;
  const { put } = await import("@vercel/blob");
  await put(key, bytes, { access: "private", addRandomSuffix: false, allowOverwrite: true });
}

export async function removeKey(key: string): Promise<void> {
  await rm(localPath(key), { force: true });
  if (!useBlob()) return;
  const { del, get } = await import("@vercel/blob");
  const file = await get(key, { access: "private", useCache: false });
  if (file?.statusCode === 200) await del(file.blob.url);
}

export async function removePrefix(prefix: string): Promise<void> {
  if (useBlob()) {
    const { del, list } = await import("@vercel/blob");
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 100 });
      if (page.blobs.length > 0) await del(page.blobs.map((item) => item.url));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }
  await rm(localPath(prefix.replace(/\/$/, "")), { recursive: true, force: true });
}
