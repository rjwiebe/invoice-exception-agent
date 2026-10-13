"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Scenario } from "@/lib/samples";

export function NewInvoiceForm({ scenarios }: { scenarios: Scenario[] }) {
  const router = useRouter();
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
        body: JSON.stringify({ scenarioId: picked }),
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
          <button key={s.id} className={picked === s.id ? "on" : ""} onClick={() => setPicked(s.id)}>
            <b>{s.title}</b>
            <small>{s.blurb}</small>
            <span className="badge b-processing">{s.expected}</span>
          </button>
        ))}
      </div>
      <div className="card">
        <h2>Safe synthetic demo</h2>
        <p className="muted">Only the built-in synthetic examples can be processed here. Custom invoice text is not accepted, so real financial documents cannot be accidentally submitted.</p>
        {picked ? (
          <pre className="doc">{scenarios.find((scenario) => scenario.id === picked)?.text}</pre>
        ) : (
          <div className="muted">Choose a scenario above to preview its sample invoice.</div>
        )}
        {error && <div className="err" role="alert">{error}</div>}
        <div style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={busy || !picked} onClick={submit}>{busy ? "Agent is working…" : "Process scenario"}</button>
        </div>
      </div>
    </div>
  );
}
