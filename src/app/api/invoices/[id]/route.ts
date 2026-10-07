import { NextResponse } from "next/server";
import { listAudit } from "@/lib/audit";
import { getInvoice } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = getInvoice(id);
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ invoice, audit: listAudit(id) });
}
