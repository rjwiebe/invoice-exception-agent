import { NextRequest, NextResponse } from "next/server";
import {
  createDemoSessionId,
  DEMO_SESSION_COOKIE,
  DEMO_SESSION_MAX_AGE,
  isValidDemoSessionId,
} from "./lib/session-id";

export function middleware(request: NextRequest) {
  const existing = request.cookies.get(DEMO_SESSION_COOKIE)?.value;
  if (isValidDemoSessionId(existing)) return NextResponse.next();

  const sessionId = createDemoSessionId();
  const cookieHeader = [
    ...request.cookies.getAll()
      .filter((cookie) => cookie.name !== DEMO_SESSION_COOKIE)
      .map((cookie) => `${cookie.name}=${cookie.value}`),
    `${DEMO_SESSION_COOKIE}=${sessionId}`,
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("cookie", cookieHeader);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.cookies.set(DEMO_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DEMO_SESSION_MAX_AGE,
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
