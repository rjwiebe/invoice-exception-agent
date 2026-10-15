import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionPanel } from "@/components/ActionPanel";
import { AuditTimeline } from "@/components/AuditTimeline";
import { StatusBadge } from "@/components/Badges";
import { listAudit } from "@/lib/audit";
import { dateTime, money } from "@/lib/format";
import { MANAGER_APPROVAL_THRESHOLD } from "@/lib/pipeline";
import { getInvoice, getVendors } from "@/lib/repo";
import { currentDemoSessionId } from "@/lib/session";
import { currentReviewer } from "@/lib/users";
import { ensureDemoSession } from "@/lib/seed";

export const dynamic = "force-dynamic";
const ICON = { pass: "✓", fail: "✕", warning: "!", skipped: "–" } as const;

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionId = await currentDemoSessionId();
  await ensureDemoSession(sessionId);
  const inv = getInvoice(id, sessionId);
  if (!inv) notFound();
  const me = currentReviewer(sessionId);
  const x = inv.extracted;
  const vendorName = inv.vendorId
    ? getVendors().find((vendor) => vendor.id === inv.vendorId)?.name ?? x?.vendorName
    : x?.vendorName;
  const audit = listAudit(sessionId, id);
  const flagged = new Set(inv.checks.flatMap((c) => c.findings.map((f) => f.field).filter(Boolean)));
  const passed = inv.checks.filter((c) => c.status === "pass").length;
  const ran = inv.checks.filter((c) => c.status !== "skipped").length;
  const hl = (...keys: string[]) =>
    keys.some((key) => flagged.has(key))
      ? { background: "var(--amber-bg)", borderRadius: 4, padding: "0 4px" }
      : undefined;

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/" className="muted">← Inbox</Link>
          <h1 style={{ marginTop: 6 }}>{x?.invoiceNumber ?? inv.id} <span className="muted" style={{ fontWeight: 400 }}>· {vendorName ?? "Unknown vendor"}</span></h1>
          <div className="sub mono">{inv.id} · received {dateTime(inv.createdAt)} via {inv.source}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <StatusBadge status={inv.status} />
          {inv.resolvedBy && <div className="muted" style={{ marginTop: 4 }}>{inv.resolvedBy}: {inv.resolvedReason}</div>}
        </div>
      </div>

      <div className="grid two">
        <div className="stack">
          <div className="card"><h2>Original document</h2><pre className="doc">{inv.rawText}</pre></div>
        </div>
        <div className="stack">
          {inv.explanation && (
            <div className="card ai">
              <h2>AI explanation <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>· {inv.explanationBy}</span></h2>
              <p style={{ margin: 0 }}>{inv.explanation.summary}</p>
              <p className="muted" style={{ marginBottom: 0 }}>{inv.explanation.rationale}</p>
              <div className="rec"><span className="muted">Suggested action</span><span className={`badge b-${inv.explanation.recommendedAction}`}>{inv.explanation.recommendedAction}</span><span className="muted">(advisory)</span></div>
            </div>
          )}

          {inv.status === "needs_review" && x && (
            <>
              {(x.total == null || x.total > MANAGER_APPROVAL_THRESHOLD) && (
                <div className="card" style={{ background: "var(--amber-bg)" }}>
                  {x.total == null
                    ? "The invoice total could not be extracted. An AP Manager is required to approve it."
                    : `Approving this invoice (${money(x.total)}) requires an AP Manager.`} You are {me.title}.
                </div>
              )}
              <ActionPanel invoiceId={inv.id} extracted={x} recommended={inv.explanation?.recommendedAction ?? null} reviewerLabel={`${me.name}, ${me.title}`} />
            </>
          )}

          <div className="card">
            <h2>Rule checks · {passed}/{ran} passed <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>· deterministic, no AI</span></h2>
            <ul className="checks">
              {inv.checks.map((c) => (
                <li key={c.id}>
                  <span className={`dot ${c.status}`}>{ICON[c.status]}</span>
                  <div>
                    <div className={c.status === "skipped" ? "muted" : ""}>{c.label}{c.status === "skipped" && " (skipped: input missing)"}</div>
                    {c.findings.map((f, i) => (
                      <div key={i} className="finding">
                        {f.relatedTo && <span className="badge b-warning">Supporting evidence · {f.relatedTo}</span>}{f.relatedTo && " "}
                        <span className="mono muted">{f.code}</span> {f.message}
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {x && (
            <div className="card">
              <h2>Extracted fields <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>· {inv.extractedBy}</span></h2>
              <dl className="kv" style={{ margin: 0 }}>
                <dt>Vendor</dt><dd style={hl("vendorName")}>{x.vendorName ?? "—"}</dd>
                <dt>Invoice #</dt><dd style={hl("invoiceNumber")}>{x.invoiceNumber ?? "—"}</dd>
                <dt>PO</dt><dd style={hl("poNumber")}>{x.poNumber ?? <span className="badge b-fail">not found</span>}</dd>
                <dt>Dates</dt><dd style={hl("invoiceDate", "dueDate")}>{x.invoiceDate ?? "—"} → due {x.dueDate ?? "—"}</dd>
                <dt>Remit account</dt><dd style={hl("bankLast4")}>{x.bankLast4 ? `••••${x.bankLast4}` : "—"}</dd>
                <dt>Subtotal / tax</dt><dd>{money(x.subtotal)} / {money(x.tax)}</dd>
                <dt>Total</dt><dd><b>{money(x.total, x.currency ?? "USD")}</b></dd>
              </dl>
              <table style={{ marginTop: 12 }}>
                <thead><tr><th>Line item</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Amount</th></tr></thead>
                <tbody>{x.lineItems.map((l, i) => <tr key={i}><td>{l.description}</td><td className="num">{l.quantity}</td><td className="num">{money(l.unitPrice)}</td><td className="num">{money(l.amount)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Audit trail</h2>
        <AuditTimeline entries={audit} />
      </div>
    </>
  );
}
