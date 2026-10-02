import path from "path";

export function dataRoot(): string {
  return process.env.VERCEL ? path.join("/tmp", "atlaxis") : path.join(process.cwd(), "data");
}
