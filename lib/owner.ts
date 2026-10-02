import { headers } from "next/headers";

export function ownerId(): string {
  const value = headers().get("x-atlaxis-owner") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error("owner_missing");
  }
  return value;
}
