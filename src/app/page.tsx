import Link from "next/link";
import { StatusBadge } from "@/components/Badges";
import { ResetButton } from "@/components/ResetButton";
import { dateTime, money } from "@/lib/format";
import { getVendors, listInvoices } from "@/lib/repo";
import { currentDemoSessionId } from "@/lib/session";
import { ensureDemoSession } from "@/lib/seed";

export const dynamic = "force-dynamic";

const TABS = [["", "All"], ["needs_review", "Needs review"], ["cleared", "Cleared for payment"], ["approved", "Approved"], ["rejected", "Rejected"]];

export default async function Inbox({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const sessionId = await currentDemoSessionId();
  await ensureDemoSession(sessionId);
  const all = listInvoices(sessionId);
  const vendorNames = new Map(getVendors().map((vendor) => [vendor.id, vendor.name] as const));
  const rows = status ? all.filter((i) => i.status === status) : all;
  const count = (s: string) => all.filter((i) => i.status === s).length;
  const decided = all.filter((i) => i.status !== "processing");
  const autoCleared = all.filter((i) => i.status === "cleared" && i.resolvedBy === "rules-engine").length;
  const autoRate = decided.length ? Math.round((autoCleared / decided.length) * 100) : 0;
  const held = all.filter((i) => i.status === "needs_review").reduce((s, i) => s + (i.extracted?.total ?? 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Invoice inbox</h1>
          <div className="sub">Clean invoices are cleared for payment. Exceptions wait here for a human.</div>
        </div>
        <Link href="/new" className="btn primary">Submit an invoice</Link>
      </div>
      <div className="grid stats">
        <div className="card stat"><div className="n">{count("needs_review")}</div><div className="l">Waiting for review</div></div>
        <div className="card stat"><div className="n">{money(held)}</div><div className="l">Value on hold</div></div>
        <div className="card stat"><div className="n">{count("cleared")}</div><div className="l">Cleared for payment</div></div>
        <div className="card stat"><div className="n">{autoRate}%</div><div className="l">Cleared without a human</div></div>
      </div>
      <div className="tabs">
        {TABS.map(([v, label]) => (
          <Link key={v} href={v ? `/?status=${v}` : "/"} className={`tab ${(status ?? "") === v ? "on" : ""}`}>{label}</Link>
        ))}
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Invoice</th><th>Vendor</th><th>PO</th><th className="num">Total</th><th>Status</th><th>Received</th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td><Link href={`/invoices/${i.id}`} className="mono"><b>{i.extracted?.invoiceNumber ?? i.id}</b></Link><div className="muted mono">{i.id}</div></td>
                <td>{(i.vendorId && vendorNames.get(i.vendorId)) ?? i.extracted?.vendorName ?? "—"}</td>
                <td className="mono">{i.extracted?.poNumber ?? "—"}</td>
                <td className="num">{money(i.extracted?.total)}</td>
                <td>
                  <StatusBadge status={i.status} />
                  {i.status === "needs_review" && i.explanation && <div className="muted" style={{ marginTop: 4 }}>AI suggests: {i.explanation.recommendedAction}</div>}
                </td>
                <td className="muted">{dateTime(i.createdAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">{status ? "No invoices in this queue right now." : "No invoices yet. Submit one to start the workflow."}</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 16 }}><ResetButton /></div>
    </>
  );
}
