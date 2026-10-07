import { z } from "zod";
import { appendAudit } from "./audit";
import { getDb } from "./db";
import { money } from "./format";
import { getProvider, mockProvider, type AIProvider } from "./ai/provider";
import { getInvoice, getPurchaseOrders, getVendors, newInvoiceId, priorInvoices } from "./repo";
import { RULESET_VERSION, evaluateInvoice } from "./rules";
import { ExplanationSchema, ExtractedSchema, type Extracted, type Invoice, type Reviewer } from "./types";

const SYSTEM = "rules-engine";
export const MANAGER_APPROVAL_THRESHOLD = 25_000;

export class PipelineError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const now = () => new Date().toISOString();

// Run an AI call, validate its output, and fall back to the mock provider (with an audit
// record) if it throws or returns something that doesn't match the schema.
async function callAI<T>(
  invoiceId: string,
  step: "extraction" | "explanation",
  provider: AIProvider,
  schema: z.ZodType<T>,
  call: (p: AIProvider) => Promise<unknown>,
): Promise<{ data: T; provider: AIProvider; latencyMs: number }> {
  const attempt = async (p: AIProvider) => {
    const t = Date.now();
    const data = schema.parse(await call(p));
    return { data, provider: p, latencyMs: Date.now() - t };
  };
  try {
    return await attempt(provider);
  } catch (err) {
    if (provider.id === mockProvider.id) throw err;
    appendAudit({
      invoiceId, actorType: "system", actor: SYSTEM, action: "ai.fallback",
      summary: `${provider.id} ${step} failed; falling back to ${mockProvider.id}`,
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    return attempt(mockProvider);
  }
}

export async function submitInvoice(rawText: string, source: string, provider: AIProvider = getProvider()): Promise<Invoice> {
  const db = getDb();
  const id = newInvoiceId();
  const ts = now();
  db.transaction(() => {
    db.prepare("INSERT INTO invoices (id, source, raw_text, status, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(id, source, rawText, "processing", ts, ts);
    appendAudit({
      invoiceId: id, actorType: "system", actor: "intake", action: "invoice.received",
      summary: `Invoice received via ${source} (${rawText.length} characters)`, details: { source },
    });
  })();

  const ex = await callAI(id, "extraction", provider, ExtractedSchema, (p) => p.extractInvoice(rawText));
  db.transaction(() => {
    db.prepare("UPDATE invoices SET extracted_json = ?, extracted_by = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(ex.data), `${ex.provider.id}:${ex.provider.model}`, now(), id,
    );
    appendAudit({
      invoiceId: id, actorType: "ai", actor: `${ex.provider.id}:${ex.provider.model}`, action: "ai.extracted",
      summary: `Extracted ${ex.data.lineItems.length} line item(s), invoice ${ex.data.invoiceNumber ?? "number not found"}, total ${money(ex.data.total)}`,
      details: { latencyMs: ex.latencyMs, output: ex.data },
    });
  })();

  await evaluateAndRoute(id, provider);
  return getInvoice(id)!;
}

// Deterministic rules decide the outcome. The AI is only asked to explain a failure afterwards.
export async function evaluateAndRoute(id: string, provider: AIProvider = getProvider(), correctedBy?: { actor: string; reason: string }) {
  const db = getDb();
  const inv = getInvoice(id)!;
  const extracted = inv.extracted!;
  const evaluation = evaluateInvoice(extracted, {
    vendors: getVendors(), purchaseOrders: getPurchaseOrders(), otherInvoices: priorInvoices(id),
  });
  const passed = evaluation.checks.filter((c) => c.status === "pass").length;
  const run = evaluation.checks.filter((c) => c.status !== "skipped").length;

  db.transaction(() => {
    db.prepare("UPDATE invoices SET vendor_id = ?, checks_json = ?, updated_at = ? WHERE id = ?").run(
      evaluation.vendorId, JSON.stringify(evaluation.checks), now(), id,
    );
    appendAudit({
      invoiceId: id, actorType: "system", actor: SYSTEM, action: "rules.evaluated",
      summary: `${passed}/${run} checks passed${evaluation.findings.length ? `; ${evaluation.findings.length} finding(s)` : ""}`,
      details: { ruleset: RULESET_VERSION, checks: evaluation.checks.map((c) => ({ id: c.id, status: c.status })), findings: evaluation.findings },
    });
  })();

  if (evaluation.cleared) {
    db.transaction(() => {
      db.prepare("UPDATE invoices SET status = 'cleared', explanation_json = NULL, explanation_by = NULL, resolved_by = ?, resolved_reason = ?, resolved_at = ?, updated_at = ? WHERE id = ?").run(
        correctedBy?.actor ?? SYSTEM,
        correctedBy ? `Corrected by reviewer, then all applicable checks passed: ${correctedBy.reason}` : "All applicable checks passed",
        now(), now(), id,
      );
      appendAudit({
        invoiceId: id, actorType: "system", actor: SYSTEM, action: "invoice.cleared",
        summary: correctedBy
          ? "All applicable checks passed after the reviewer's correction. Invoice cleared for payment."
          : "All applicable checks passed. Invoice cleared for payment with no human involvement.",
        details: {},
      });
    })();
    return;
  }

  const vendorName = evaluation.vendorId ? getVendors().find((v) => v.id === evaluation.vendorId)?.name ?? null : null;
  const ex = await callAI(id, "explanation", provider, ExplanationSchema, (p) =>
    p.explainExceptions({ invoice: extracted, vendorName, findings: evaluation.findings }),
  );
  db.transaction(() => {
    db.prepare("UPDATE invoices SET status = 'needs_review', explanation_json = ?, explanation_by = ?, resolved_by = NULL, resolved_reason = NULL, resolved_at = NULL, updated_at = ? WHERE id = ?").run(
      JSON.stringify(ex.data), `${ex.provider.id}:${ex.provider.model}`, now(), id,
    );
    appendAudit({
      invoiceId: id, actorType: "ai", actor: `${ex.provider.id}:${ex.provider.model}`, action: "ai.explained",
      summary: `Explained exception; recommends "${ex.data.recommendedAction}" (advisory only)`,
      details: { latencyMs: ex.latencyMs, output: ex.data },
    });
    appendAudit({
      invoiceId: id, actorType: "system", actor: SYSTEM, action: "invoice.routed",
      summary: "Routed to human review", details: { reason: "findings present" },
    });
  })();
}

export const EDITABLE_FIELDS = ["vendorName", "invoiceNumber", "invoiceDate", "dueDate", "poNumber", "currency"] as const;

export const DecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), reason: z.string().trim().min(5, "A reason of at least 5 characters is required") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(5, "A reason of at least 5 characters is required") }),
  z.object({
    action: z.literal("correct"),
    reason: z.string().trim().min(5, "A reason of at least 5 characters is required"),
    corrections: z.object(Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, z.string().trim().nullable().optional()]))),
  }),
]);
export type Decision = z.infer<typeof DecisionSchema>;

export async function decide(id: string, decision: Decision, reviewer: Reviewer, provider: AIProvider = getProvider()): Promise<Invoice> {
  const db = getDb();
  const inv = getInvoice(id);
  if (!inv) throw new PipelineError("Invoice not found", 404);
  if (inv.status !== "needs_review") throw new PipelineError(`Invoice is ${inv.status}; only invoices in review can be decided`, 409);
  const extracted = inv.extracted!;

  if (
    decision.action === "approve" &&
    (extracted.total == null || extracted.total > MANAGER_APPROVAL_THRESHOLD) &&
    reviewer.role !== "ap_manager"
  ) {
    const requirement = extracted.total == null
      ? "Approving an invoice with an unknown total requires an AP Manager"
      : `Approving invoices over ${money(MANAGER_APPROVAL_THRESHOLD)} requires an AP Manager`;
    throw new PipelineError(requirement, 403);
  }

  const actor = `${reviewer.name} (${reviewer.title})`;
  const record = (action: string, corrections: unknown) =>
    db.prepare("INSERT INTO reviews (invoice_id, action, reason, reviewer, role, corrections_json, created_at) VALUES (?,?,?,?,?,?,?)").run(
      id, action, decision.reason, reviewer.name, reviewer.role, corrections ? JSON.stringify(corrections) : null, now(),
    );

  if (decision.action === "correct") {
    const changes: Record<string, { from: string | null; to: string | null }> = {};
    const next: Extracted = { ...extracted };
    for (const f of EDITABLE_FIELDS) {
      const raw = decision.corrections[f];
      if (raw === undefined) continue;
      const to = raw === "" || raw === null
        ? null
        : f === "poNumber" || f === "currency"
          ? raw.toUpperCase()
          : raw;
      if (to !== extracted[f]) {
        changes[f] = { from: extracted[f], to };
        (next as Record<string, unknown>)[f] = to;
      }
    }
    if (Object.keys(changes).length === 0) throw new PipelineError("No fields were changed");
    const validated = ExtractedSchema.safeParse(next);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      throw new PipelineError(`Invalid ${String(issue.path[0] ?? "correction")}: ${issue.message}`);
    }
    db.transaction(() => {
      db.prepare("UPDATE invoices SET extracted_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(validated.data), now(), id);
      record("correct", changes);
      appendAudit({
        invoiceId: id, actorType: "human", actor, action: "review.corrected",
        summary: `Corrected ${Object.keys(changes).join(", ")}: "${decision.reason}"`, details: { changes, reason: decision.reason },
      });
    })();
    await evaluateAndRoute(id, provider, { actor, reason: decision.reason });
    return getInvoice(id)!;
  }

  const status = decision.action === "approve" ? "approved" : "rejected";
  db.transaction(() => {
    db.prepare("UPDATE invoices SET status = ?, resolved_by = ?, resolved_reason = ?, resolved_at = ?, updated_at = ? WHERE id = ?").run(
      status, actor, decision.reason, now(), now(), id,
    );
    record(decision.action, null);
    appendAudit({
      invoiceId: id, actorType: "human", actor, action: `review.${status}`,
      summary: `${decision.action === "approve" ? "Approved despite exceptions" : "Rejected"}: "${decision.reason}"`,
      details: {
        reason: decision.reason,
        aiRecommended: inv.explanation?.recommendedAction ?? null,
        followedAiRecommendation: inv.explanation?.recommendedAction === decision.action,
        overriddenFindings: decision.action === "approve" ? inv.checks.flatMap((c) => c.findings).map((f) => f.code) : undefined,
      },
    });
  })();
  return getInvoice(id)!;
}
