import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * A fast first gate only.
 *
 * Proxy (middleware's name from Next 16) sees the cookie but not the session
 * record, so it can bounce an obviously signed-out visitor without a database
 * round trip. It is never the
 * authority: the page re-checks with `getCurrentUser`, and every API handler
 * validates the session and scopes its queries by user id. An expired or forged
 * cookie gets past this and is rejected there.
 */
export function proxy(request: NextRequest) {
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = request.nextUrl;

  if (pathname === "/" && !hasSessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Signed-in users have no reason to see the auth pages.
  if ((pathname === "/login" || pathname === "/register") && hasSessionCookie) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/register"],
};
