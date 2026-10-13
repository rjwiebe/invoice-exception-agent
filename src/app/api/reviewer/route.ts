import { NextResponse } from "next/server";
import { z } from "zod";
import { missingSessionResponse, requestSessionId } from "@/lib/api-session";
import { changeReviewer, REVIEWERS } from "@/lib/users";
import { ensureDemoSession } from "@/lib/seed";

const Body = z.object({ id: z.string().trim().min(1).max(30) }).strict();

export async function POST(req: Request) {
  const sessionId = requestSessionId(req);
  if (!sessionId) return missingSessionResponse();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !REVIEWERS.some((r) => r.id === parsed.data.id)) {
    return NextResponse.json({ error: "Choose a known demo persona." }, { status: 400 });
  }
  await ensureDemoSession(sessionId);
  return NextResponse.json({ reviewer: changeReviewer(sessionId, parsed.data.id) });
}
