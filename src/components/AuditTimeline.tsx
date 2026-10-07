import { dateTime } from "@/lib/format";
import type { AuditEntry } from "@/lib/types";

export function AuditTimeline({ entries, showInvoice = false }: { entries: AuditEntry[]; showInvoice?: boolean }) {
  return (
    <ul className="timeline">
      {entries.map((e) => (
        <li key={e.seq} className={`t-${e.actorType}`}>
          <div>
            <span className={`badge b-${e.actorType}`}>{e.actorType === "ai" ? "AI" : e.actorType}</span>{" "}
            <b>{e.actor}</b> <span className="muted mono">{e.action}</span>
            {showInvoice && e.invoiceId && <> · <a href={`/invoices/${e.invoiceId}`} className="mono">{e.invoiceId}</a></>}
            <span className="muted"> · {dateTime(e.ts)}</span>
          </div>
          <div>{e.summary}</div>
          <details>
            <summary>#{e.seq} · details &amp; hash</summary>
            <pre>{JSON.stringify(e.details, null, 2)}</pre>
            <div className="hash">prev {e.prevHash.slice(0, 16)}… → hash {e.hash.slice(0, 16)}…</div>
          </details>
        </li>
      ))}
    </ul>
  );
}
