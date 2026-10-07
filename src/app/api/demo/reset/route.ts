import { NextResponse } from "next/server";
import { seedDemo } from "@/lib/seed";

export async function POST() {
  try {
    await seedDemo();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Demo reset failed", error);
    return NextResponse.json({ error: "Demo data could not be reset." }, { status: 500 });
  }
}
