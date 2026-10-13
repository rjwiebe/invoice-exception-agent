import { getDb } from "./db";
import { appendAudit } from "./audit";
import type { Reviewer } from "./types";

// These are simulated personas for one anonymous browser session, not real users.
export const REVIEWERS: Reviewer[] = [
  { id: "sam", name: "Sam Okafor", role: "ap_clerk", title: "AP Clerk" },
  { id: "dana", name: "Dana Reyes", role: "ap_manager", title: "AP Manager" },
];

export function currentReviewer(sessionId: string): Reviewer {
  const row = getDb().prepare("SELECT reviewer_id FROM demo_sessions WHERE session_id = ?").get(sessionId) as { reviewer_id: string } | undefined;
  if (!row) throw new Error("Demo session has not been initialized");
  const reviewer = REVIEWERS.find((r) => r.id === row.reviewer_id);
  if (!reviewer) throw new Error("Demo session has an invalid reviewer persona");
  return reviewer;
}

export function changeReviewer(sessionId: string, reviewerId: string): Reviewer {
  const next = REVIEWERS.find((r) => r.id === reviewerId);
  if (!next) throw new Error("Unknown demo persona");
  const previous = currentReviewer(sessionId);
  if (previous.id === next.id) return next;
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE demo_sessions SET reviewer_id = ?, updated_at = ? WHERE session_id = ?").run(
      next.id,
      new Date().toISOString(),
      sessionId,
    );
    appendAudit(sessionId, {
      invoiceId: null,
      actorType: "human",
      actor: "Demo persona switcher",
      action: "demo.persona_changed",
      summary: `Switched simulated persona from ${previous.title} to ${next.title}`,
      details: { from: previous.id, to: next.id, authentication: false },
    });
  })();
  return next;
}
