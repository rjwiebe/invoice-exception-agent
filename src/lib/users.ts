import { cookies } from "next/headers";
import type { Reviewer } from "./types";

// Demo identity only: a cookie picks which reviewer you are. The server, not the
// request body, decides who the actor is and what their role allows.
export const REVIEWERS: Reviewer[] = [
  { id: "sam", name: "Sam Okafor", role: "ap_clerk", title: "AP Clerk" },
  { id: "dana", name: "Dana Reyes", role: "ap_manager", title: "AP Manager" },
];

export async function currentReviewer(): Promise<Reviewer> {
  const id = (await cookies()).get("reviewer")?.value;
  return REVIEWERS.find((r) => r.id === id) ?? REVIEWERS[0];
}
