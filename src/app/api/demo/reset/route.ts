import { NextResponse } from "next/server";
import { missingSessionResponse, requestSessionId } from "@/lib/api-session";
import { resetDemoSession } from "@/lib/seed";

export async function POST(req: Request) {
  const sessionId = requestSessionId(req);
  if (!sessionId) return missingSessionResponse();
  try {
    await resetDemoSession(sessionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Demo reset failed", error);
    return NextResponse.json({ error: "Demo data could not be reset." }, { status: 500 });
  }
}
