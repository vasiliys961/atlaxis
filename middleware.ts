import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE = "atlaxis_owner";

export function middleware(request: NextRequest) {
  const existing = request.cookies.get(COOKIE)?.value;
  const ownerId = existing && /^[0-9a-f-]{36}$/i.test(existing) ? existing : crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("x-atlaxis-owner", ownerId);
  const response = NextResponse.next({ request: { headers } });
  if (ownerId !== existing) {
    response.cookies.set(COOKIE, ownerId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
