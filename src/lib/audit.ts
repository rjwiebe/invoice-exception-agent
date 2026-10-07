import crypto from "node:crypto";
import { getDb } from "./db";
import type { ActorType, AuditEntry } from "./types";

const GENESIS = "GENESIS";

const hashEntry = (prev: string, f: [string | null, string, string, string, string, string, string]) =>
  crypto.createHash("sha256").update(JSON.stringify([prev, ...f])).digest("hex");

interface Row {
  seq: number; invoice_id: string | null; ts: string; actor_type: ActorType; actor: string;
  action: string; summary: string; details: string; prev_hash: string; hash: string;
}

const toEntry = (r: Row): AuditEntry => ({
  seq: r.seq, invoiceId: r.invoice_id, ts: r.ts, actorType: r.actor_type, actor: r.actor,
  action: r.action, summary: r.summary, details: JSON.parse(r.details), prevHash: r.prev_hash, hash: r.hash,
});

// Append-only. Each entry's hash covers the previous entry's hash, so editing or
// deleting any historical row breaks every hash after it.
export function appendAudit(e: {
  invoiceId: string | null; actorType: ActorType; actor: string; action: string; summary: string; details?: unknown;
}): AuditEntry {
  const db = getDb();
  return db.transaction(() => {
    const last = db.prepare("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1").get() as { hash: string } | undefined;
    const prev = last?.hash ?? GENESIS;
    const ts = new Date().toISOString();
    const details = JSON.stringify(e.details ?? {});
    const hash = hashEntry(prev, [e.invoiceId, ts, e.actorType, e.actor, e.action, e.summary, details]);
    const info = db
      .prepare(
        "INSERT INTO audit_log (invoice_id, ts, actor_type, actor, action, summary, details, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(e.invoiceId, ts, e.actorType, e.actor, e.action, e.summary, details, prev, hash);
    return toEntry(db.prepare("SELECT * FROM audit_log WHERE seq = ?").get(info.lastInsertRowid) as Row);
  })();
}

export function listAudit(invoiceId?: string, limit = 500): AuditEntry[] {
  const db = getDb();
  const rows = invoiceId
    ? db.prepare("SELECT * FROM audit_log WHERE invoice_id = ? ORDER BY seq ASC").all(invoiceId)
    : db.prepare("SELECT * FROM (SELECT * FROM audit_log ORDER BY seq DESC LIMIT ?) ORDER BY seq DESC").all(limit);
  return (rows as Row[]).map(toEntry);
}

export function verifyAuditChain(): { ok: boolean; entries: number; brokenAtSeq?: number } {
  const rows = getDb().prepare("SELECT * FROM audit_log ORDER BY seq ASC").all() as Row[];
  let prev = GENESIS;
  for (const r of rows) {
    const expected = hashEntry(prev, [r.invoice_id, r.ts, r.actor_type, r.actor, r.action, r.summary, r.details]);
    if (r.prev_hash !== prev || r.hash !== expected) return { ok: false, entries: rows.length, brokenAtSeq: r.seq };
    prev = r.hash;
  }
  return { ok: true, entries: rows.length };
}
