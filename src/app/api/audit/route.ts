import { NextResponse } from "next/server";
import { listAudit } from "@/lib/audit";
import { missingSessionResponse, requestSessionId } from "@/lib/api-session";
import { ensureDemoSession } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sessionId = requestSessionId(req);
  if (!sessionId) return missingSessionResponse();
  await ensureDemoSession(sessionId);
  return NextResponse.json(listAudit(sessionId, new URL(req.url).searchParams.get("invoiceId") ?? undefined));
}
