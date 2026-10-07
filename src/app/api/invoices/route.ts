import { NextResponse } from "next/server";
import { z } from "zod";
import { PipelineError, submitInvoice } from "@/lib/pipeline";
import { listInvoices } from "@/lib/repo";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status") ?? undefined;
  return NextResponse.json(listInvoices(status));
}

const Body = z.object({
  rawText: z.string().trim().min(20, "Paste the invoice text (at least 20 characters)").max(20_000, "Invoice text must be 20,000 characters or fewer"),
  source: z.string().max(100).default("manual upload"),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  try {
    return NextResponse.json(await submitInvoice(parsed.data.rawText, parsed.data.source), { status: 201 });
  } catch (e) {
    if (e instanceof PipelineError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("Invoice submission failed", e);
    return NextResponse.json({ error: "Invoice processing failed. Please try again; check server logs if it persists." }, { status: 500 });
  }
}
