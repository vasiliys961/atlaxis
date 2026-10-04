import path from "path";

export function dataRoot(): string {
  // Локально и в тестах файлы лежат на диске. На Vercel без токена Blob остаётся только /tmp.
  // С BLOB_READ_WRITE_TOKEN состояние и оригиналы пишутся в закрытое хранилище.
  return process.env.VERCEL ? path.join("/tmp", "atlaxis") : path.join(process.cwd(), "data");
}
