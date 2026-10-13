import { NextResponse } from "next/server";
import { sessionIdFromCookieHeader } from "./session-id";

export function requestSessionId(request: Request): string | null {
  return sessionIdFromCookieHeader(request.headers.get("cookie"));
}

export function missingSessionResponse() {
  return NextResponse.json({ error: "A valid demo session is required. Reload the page to start a session." }, { status: 401 });
}
