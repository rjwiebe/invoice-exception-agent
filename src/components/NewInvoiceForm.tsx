"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Scenario } from "@/lib/samples";

export function NewInvoiceForm({ scenarios }: { scenarios: Scenario[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: text, source: picked ? "sample scenario" : "manual paste" }),
      });
      const json = await res.json().catch(() => null) as { id?: string; error?: string } | null;
      if (!res.ok) {
        setError(json?.error ?? "Invoice processing failed.");
        return;
      }
      if (!json?.id) {
        setError("The server returned an invalid response. Please try again.");
        return;
      }
      router.push(`/invoices/${json.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="grid scen">
        {scenarios.map((s) => (
          <button key={s.id} className={picked === s.id ? "on" : ""} onClick={() => { setText(s.text); setPicked(s.id); }}>
            <b>{s.title}</b>
            <small>{s.blurb}</small>
            <span className="badge b-processing">{s.expected}</span>
          </button>
        ))}
      </div>
      <div className="card">
        <label htmlFor="raw">Invoice text (as it would arrive from email or OCR)</label>
        <textarea id="raw" rows={16} className="mono" value={text} onChange={(e) => { setText(e.target.value); setPicked(null); }} placeholder="Pick a scenario above, or paste invoice text…" />
        {error && <div className="err" role="alert">{error}</div>}
        <div style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={busy || text.trim().length < 20} onClick={submit}>{busy ? "Agent is working…" : "Process invoice"}</button>
        </div>
      </div>
    </div>
  );
}
