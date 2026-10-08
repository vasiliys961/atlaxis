import path from "path";

export function dataRoot(): string {
  // Serverless instance filesystems are ephemeral and must never be used as
  // the sole patient-data store in production.
  if (process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("persistent_patient_storage_required");
  }
  return process.env.VERCEL ? path.join("/tmp", "atlaxis") : path.join(process.cwd(), "data");
}
