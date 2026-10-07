"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Extracted, RecommendedAction } from "@/lib/types";

const FIELDS = [
  ["vendorName", "Vendor name"], ["invoiceNumber", "Invoice number"], ["poNumber", "PO number"],
  ["invoiceDate", "Invoice date"], ["dueDate", "Due date"], ["currency", "Currency"],
] as const;

export function ActionPanel({ invoiceId, extracted, recommended, reviewerLabel }: {
  invoiceId: string; extracted: Extracted; recommended: RecommendedAction | null; reviewerLabel: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"approve" | "reject" | "correct">(recommended ?? "reject");
  const [reason, setReason] = useState("");
  const [fields, setFields] = useState<Record<string, string>>(Object.fromEntries(FIELDS.map(([k]) => [k, extracted[k] ?? ""])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body = mode === "correct" ? { action: mode, reason, corrections: fields } : { action: mode, reason };
      const res = await fetch(`/api/invoices/${invoiceId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) {
        setError(json?.error ?? "The decision could not be saved.");
        return;
      }
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const labels = { approve: "Approve anyway", reject: "Reject", correct: "Correct & re-check" } as const;
  return (
    <div className="card">
      <h2>Your decision · acting as {reviewerLabel}</h2>
      <div className="seg">
        {(["approve", "reject", "correct"] as const).map((m) => (
          <button key={m} className={`btn ${mode === m ? "on" : ""}`} onClick={() => setMode(m)}>
            {labels[m]}{recommended === m ? " ★" : ""}
          </button>
        ))}
      </div>
      {mode === "correct" && (
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 12 }}>
          {FIELDS.map(([k, label]) => (
            <div key={k}>
              <label htmlFor={k}>{label}</label>
              <input
                id={k}
                type={k === "invoiceDate" || k === "dueDate" ? "date" : "text"}
                value={fields[k]}
                onChange={(e) => setFields({ ...fields, [k]: e.target.value })}
              />
            </div>
          ))}
        </div>
      )}
      <label htmlFor="reason">{mode === "correct" ? "Why is this correction right?" : "Reason (recorded in the audit log)"}</label>
      <textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby="reason-hint" />
      <div id="reason-hint" className="muted small-hint">Enter at least 5 characters. The reason is stored with the decision.</div>
      {error && <div className="err" role="alert">{error}</div>}
      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
        <button className={`btn ${mode === "approve" ? "good" : mode === "reject" ? "danger" : "primary"}`} disabled={busy || reason.trim().length < 5} onClick={submit}>
          {busy ? "Saving…" : labels[mode]}
        </button>
        <span className="muted">★ = AI recommendation. It is advisory; you decide.</span>
      </div>
    </div>
  );
}
