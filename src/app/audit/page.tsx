import { AuditTimeline } from "@/components/AuditTimeline";
import { listAudit, verifyAuditChain } from "@/lib/audit";

export const dynamic = "force-dynamic";

export default function AuditPage() {
  const v = verifyAuditChain();
  const entries = listAudit(undefined, 200);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <div className="sub">Entries are linked by SHA-256 hashes. Changes within the chain are detectable; an external checkpoint is needed to detect tail truncation.</div>
        </div>
        <span className={`chain ${v.ok ? "ok" : "bad"}`}>{v.ok ? `✓ Chain verified · ${v.entries} entries` : `✕ Chain broken at entry #${v.brokenAtSeq}`}</span>
      </div>
      <div className="card"><AuditTimeline entries={entries} showInvoice /></div>
    </>
  );
}
