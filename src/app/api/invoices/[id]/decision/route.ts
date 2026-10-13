import { NextResponse } from "next/server";
import { missingSessionResponse, requestSessionId } from "@/lib/api-session";
import { DecisionSchema, PipelineError, decide } from "@/lib/pipeline";
import { currentReviewer } from "@/lib/users";
import { ensureDemoSession } from "@/lib/seed";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionId = requestSessionId(req);
  if (!sessionId) return missingSessionResponse();
  const { id } = await params;
  const parsed = DecisionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  try {
    await ensureDemoSession(sessionId);
    return NextResponse.json(await decide(id, sessionId, parsed.data, currentReviewer(sessionId)));
  } catch (e) {
    if (e instanceof PipelineError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("Invoice decision failed", e);
    return NextResponse.json({ error: "The decision could not be saved. Please try again; check server logs if it persists." }, { status: 500 });
  }
}
