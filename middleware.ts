import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createOwnerSession, sessionSecret, verifyOwnerSession } from "./lib/owner-session";

const COOKIE = "atlaxis_owner";

export async function middleware(request: NextRequest) {
  let secret: string;
  try {
    secret = sessionSecret();
  } catch {
    return new NextResponse("Session service unavailable", { status: 503 });
  }

  const existing = request.cookies.get(COOKIE)?.value;
  const validId = await verifyOwnerSession(existing, secret);
  const ownerId = validId ?? crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("x-atlaxis-owner", ownerId);
  const response = NextResponse.next({ request: { headers } });
  if (!validId) {
    response.cookies.set(COOKIE, await createOwnerSession(ownerId, secret), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 24 * 60 * 60,
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
