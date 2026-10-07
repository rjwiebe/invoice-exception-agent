import { NextResponse } from "next/server";
import { DecisionSchema, PipelineError, decide } from "@/lib/pipeline";
import { currentReviewer } from "@/lib/users";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = DecisionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  try {
    // The selected demo persona comes from a server-set cookie, not the decision body.
    // This selector is for demonstration and is not an authentication boundary.
    return NextResponse.json(await decide(id, parsed.data, await currentReviewer()));
  } catch (e) {
    if (e instanceof PipelineError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("Invoice decision failed", e);
    return NextResponse.json({ error: "The decision could not be saved. Please try again; check server logs if it persists." }, { status: 500 });
  }
}
