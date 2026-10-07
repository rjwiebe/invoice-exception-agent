import { NextResponse } from "next/server";
import { listAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return NextResponse.json(listAudit(new URL(req.url).searchParams.get("invoiceId") ?? undefined));
}
