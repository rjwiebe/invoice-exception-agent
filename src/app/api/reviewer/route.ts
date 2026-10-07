import { NextResponse } from "next/server";
import { REVIEWERS } from "@/lib/users";

export async function POST(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!REVIEWERS.some((r) => r.id === id)) return NextResponse.json({ error: "Unknown reviewer" }, { status: 400 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set("reviewer", id!, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return res;
}
