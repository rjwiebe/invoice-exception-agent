"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ResetButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          if (!confirm("Reset all demo data, including the audit log?")) return;
          setBusy(true);
          setError(null);
          try {
            const response = await fetch("/api/demo/reset", { method: "POST" });
            if (!response.ok) throw new Error("The demo data could not be reset.");
            router.push("/");
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not reach the server.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Resetting…" : "Reset demo data"}
      </button>
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  );
}
