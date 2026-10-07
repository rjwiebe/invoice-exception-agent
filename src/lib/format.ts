export const money = (n: number | null | undefined, currency = "USD") =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency });

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });

export const STATUS_LABEL: Record<string, string> = {
  processing: "Processing",
  cleared: "Cleared",
  needs_review: "Needs review",
  approved: "Approved (override)",
  rejected: "Rejected",
};
