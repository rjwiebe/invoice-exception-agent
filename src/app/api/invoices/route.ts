import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureDemoSession } from "@/lib/seed";
import { missingSessionResponse, requestSessionId } from "@/lib/api-session";
import { PipelineError, submitInvoice } from "@/lib/pipeline";
import { listInvoices } from "@/lib/repo";
import { SCENARIOS } from "@/lib/samples";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sessionId = requestSessionId(req);
  if (!sessionId) return missingSessionResponse();
  await ensureDemoSession(sessionId);
  const status = new URL(req.url).searchParams.get("status") ?? undefined;
  return NextResponse.json(listInvoices(sessionId, status));
}

const Body = z.object({ scenarioId: z.string().trim().min(1).max(50) }).strict();

export async function POST(req: Request) {
  const sessionId = requestSessionId(req);
  if (!sessionId) return missingSessionResponse();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const scenario = SCENARIOS.find((item) => item.id === parsed.data.scenarioId);
  if (!scenario) return NextResponse.json({ error: "Choose one of the synthetic demo scenarios." }, { status: 400 });
  try {
    await ensureDemoSession(sessionId);
    return NextResponse.json(await submitInvoice(sessionId, scenario.text, "synthetic demo scenario"), { status: 201 });
  } catch (e) {
    if (e instanceof PipelineError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("Invoice submission failed", e);
    return NextResponse.json({ error: "Invoice processing failed. Please try again; check server logs if it persists." }, { status: 500 });
  }
}
