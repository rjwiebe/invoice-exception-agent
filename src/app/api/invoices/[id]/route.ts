import { NextResponse } from "next/server";
import { listAudit } from "@/lib/audit";
import { missingSessionResponse, requestSessionId } from "@/lib/api-session";
import { getInvoice } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionId = requestSessionId(req);
  if (!sessionId) return missingSessionResponse();
  const { id } = await params;
  const invoice = getInvoice(id, sessionId);
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ invoice, audit: listAudit(sessionId, id) });
}
