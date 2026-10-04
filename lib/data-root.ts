import path from "path";

export function dataRoot(): string {
  // На Vercel каталог временный: инстанс не хранит файлы пациента между запусками.
  // Постоянное хранилище — отдельное решение, его нет в этой поставке.
  return process.env.VERCEL ? path.join("/tmp", "atlaxis") : path.join(process.cwd(), "data");
}
