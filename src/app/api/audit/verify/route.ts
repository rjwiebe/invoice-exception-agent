import { NextResponse } from "next/server";
import { missingSessionResponse, requestSessionId } from "@/lib/api-session";
import { verifyAuditChain } from "@/lib/audit";
import { ensureDemoSession } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sessionId = requestSessionId(req);
  if (!sessionId) return missingSessionResponse();
  await ensureDemoSession(sessionId);
  return NextResponse.json(verifyAuditChain(sessionId));
}
