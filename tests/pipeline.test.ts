import { beforeEach, describe, expect, it } from "vitest";
import { listAudit, verifyAuditChain } from "../src/lib/audit";
import { getDb } from "../src/lib/db";
import { mockProvider } from "../src/lib/ai/provider";
import type { AIProvider } from "../src/lib/ai/provider";
import { PipelineError, decide, submitInvoice } from "../src/lib/pipeline";
import { getInvoice } from "../src/lib/repo";
import { SCENARIOS } from "../src/lib/samples";
import { seedDemo } from "../src/lib/seed";
import { REVIEWERS } from "../src/lib/users";

const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!.text;
const submit = (id: string) => submitInvoice(scenario(id), "test", mockProvider);
const manager = REVIEWERS.find((reviewer) => reviewer.role === "ap_manager");
const clerk = REVIEWERS.find((reviewer) => reviewer.role === "ap_clerk");
if (!manager || !clerk) throw new Error("Test reviewers are not configured");
const codes = (inv: Awaited<ReturnType<typeof submit>>) => inv.checks.flatMap((c) => c.findings.map((f) => f.code));

beforeEach(async () => {
  await seedDemo();
});

describe("routing", () => {
  it("auto-clears a clean invoice", async () => {
    const inv = await submit("clean");
    expect(inv.status).toBe("cleared");
    expect(inv.explanation).toBeNull();
  });

  it("does not guess a missing currency", async () => {
    const text = scenario("clean").replaceAll("USD", "");
    const inv = await submitInvoice(text, "test", mockProvider);
    expect(inv.status).toBe("needs_review");
    expect(codes(inv)).toContain("MISSING_FIELD");
    expect(inv.extracted?.currency).toBeNull();
  });

  it("does not infer a due date from payment terms", async () => {
    const text = scenario("missing-po").replace(/^Due date:.*\n/m, "");
    const inv = await submitInvoice(text, "test", mockProvider);
    expect(inv.status).toBe("needs_review");
    expect(inv.extracted?.dueDate).toBeNull();
    expect(inv.checks.flatMap((c) => c.findings).some((f) => f.field === "dueDate")).toBe(true);
  });

  it("validates provider output, falls back to the mock, and audits both failures", async () => {
    const invalidProvider: AIProvider = {
      id: "invalid-test",
      model: "unit-test",
      async extractInvoice() { return { vendorName: 42 }; },
      async explainExceptions() { return { recommendedAction: "pay" }; },
    };
    const inv = await submitInvoice(scenario("bank"), "test", invalidProvider);
    expect(inv.status).toBe("needs_review");
    expect(inv.explanationBy).toBe("mock:mock-v1");
    expect(listAudit(inv.id).filter((entry) => entry.action === "ai.fallback")).toHaveLength(2);
  });

  it("checks total against line items when the subtotal is absent", async () => {
    const text = scenario("clean")
      .replace(/^Subtotal:.*\n/m, "")
      .replace("Total Due: USD 4,815.00", "Total Due: USD 4,816.00");
    const inv = await submitInvoice(text, "test", mockProvider);
    expect(inv.status).toBe("needs_review");
    expect(codes(inv)).toContain("TOTAL_MISMATCH");
  });

  it.each([
    ["price", "PRICE_VARIANCE"],
    ["duplicate", "DUPLICATE_INVOICE"],
    ["bank", "BANK_DETAILS_CHANGED"],
    ["overbilled", "OVER_PO_BALANCE"],
    ["missing-po", "MISSING_FIELD"],
    ["inactive", "INACTIVE_VENDOR"],
  ])("routes %s to review with %s", async (id, code) => {
    const inv = await submit(id);
    expect(inv.status).toBe("needs_review");
    expect(codes(inv)).toContain(code);
    expect(inv.explanation?.summary).toBeTruthy();
  });
});

describe("human decisions", () => {
  it("correcting the missing PO re-runs checks and clears", async () => {
    const inv = await submit("missing-po");
    const after = await decide(inv.id, { action: "correct", reason: "PO found in order history", corrections: { poNumber: "po-10025" } }, clerk, mockProvider);
    expect(after.extracted?.poNumber).toBe("PO-10025");
    expect(after.status).toBe("cleared");
  });

  it("rejects invalid dates in a correction without changing the invoice", async () => {
    const inv = await submit("missing-po");
    await expect(
      decide(inv.id, { action: "correct", reason: "Trying an invalid invoice date", corrections: { invoiceDate: "2026-02-30" } }, clerk, mockProvider),
    ).rejects.toMatchObject({ status: 400 });
    expect(getInvoice(inv.id)?.status).toBe("needs_review");
  });

  it("requires a manager to approve over the threshold", async () => {
    const inv = await submit("duplicate"); // $48,000
    await expect(decide(inv.id, { action: "approve", reason: "Looks fine to me" }, clerk, mockProvider)).rejects.toBeInstanceOf(PipelineError);
    expect((await decide(inv.id, { action: "approve", reason: "Vendor re-sent by mistake, ok" }, manager, mockProvider)).status).toBe("approved");
  });

  it("requires a manager when the extracted total is unknown", async () => {
    const text = scenario("bank").replace(/Total Due: USD [\d,]+\.\d{2}/, "Total Due: USD not stated");
    const inv = await submitInvoice(text, "test", mockProvider);
    expect(inv.extracted?.total).toBeNull();
    await expect(
      decide(inv.id, { action: "approve", reason: "Approved after manual amount check" }, clerk, mockProvider),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("cannot decide an invoice twice", async () => {
    const inv = await submit("bank");
    await decide(inv.id, { action: "reject", reason: "Suspected fraud" }, clerk, mockProvider);
    await expect(decide(inv.id, { action: "reject", reason: "Again" }, clerk, mockProvider)).rejects.toMatchObject({ status: 409 });
  });
});

describe("audit log", () => {
  it("records every step and verifies", async () => {
    const inv = await submit("bank");
    await decide(inv.id, { action: "reject", reason: "Suspected fraud" }, manager, mockProvider);
    expect(listAudit(inv.id).map((e) => e.action)).toEqual([
      "invoice.received", "ai.extracted", "rules.evaluated", "ai.explained", "invoice.routed", "review.rejected",
    ]);
    expect(verifyAuditChain().ok).toBe(true);
  });

  it("detects tampering", async () => {
    const inv = await submit("clean");
    getDb().prepare("UPDATE audit_log SET summary = 'edited' WHERE invoice_id = ? AND action = 'rules.evaluated'").run(inv.id);
    expect(verifyAuditChain().ok).toBe(false);
  });
});
