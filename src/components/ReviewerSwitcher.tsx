"use client";
import { useRouter } from "next/navigation";
import type { Reviewer } from "@/lib/types";
import { useState } from "react";

export function ReviewerSwitcher({ reviewers, currentId }: { reviewers: Reviewer[]; currentId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="who" title="These roles are simulated within this browser session. They are not real user authentication.">
      <select
        value={currentId}
        disabled={busy}
        aria-label="Acting reviewer"
        onChange={async (e) => {
          setBusy(true);
          setError(null);
          try {
            const response = await fetch("/api/reviewer", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: e.target.value }),
            });
            if (!response.ok) throw new Error("The reviewer could not be changed.");
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not reach the server.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {reviewers.map((r) => (
          <option key={r.id} value={r.id}>{r.name} · {r.title} (demo)</option>
        ))}
      </select>
      {error && <span className="who-error" role="alert">{error}</span>}
    </div>
  );
}
