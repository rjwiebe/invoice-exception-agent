import { beforeEach, describe, expect, it } from "vitest";
import { GET as getAudit } from "../src/app/api/audit/route";
import { GET as verifyAudit } from "../src/app/api/audit/verify/route";
import { POST as resetRoute } from "../src/app/api/demo/reset/route";
import { GET as getInvoiceRoute } from "../src/app/api/invoices/[id]/route";
import { POST as decisionRoute } from "../src/app/api/invoices/[id]/decision/route";
import { GET as getInvoices, POST as submitScenarioRoute } from "../src/app/api/invoices/route";
import { POST as changeReviewerRoute } from "../src/app/api/reviewer/route";
import { listAudit, verifyAuditChain } from "../src/lib/audit";
import { getDb } from "../src/lib/db";
import type { AIProvider } from "../src/lib/ai/provider";
import { mockProvider } from "../src/lib/ai/provider";
import { PipelineError, decide, submitInvoice } from "../src/lib/pipeline";
import { getInvoice, listInvoices } from "../src/lib/repo";
import { SCENARIOS } from "../src/lib/samples";
import { ensureDemoSession, resetLocalDemoData, resetDemoSession } from "../src/lib/seed";
import { sessionIdFromCookieHeader, DEMO_SESSION_COOKIE } from "../src/lib/session-id";
import { changeReviewer, currentReviewer, REVIEWERS } from "../src/lib/users";

const SESSION_A = "A".repeat(43);
const SESSION_B = "B".repeat(43);
const cookie = (sessionId: string) => `${DEMO_SESSION_COOKIE}=${sessionId}`;
const request = (path: string, sessionId?: string, init: RequestInit = {}) =>
  new Request(`http://localhost${path}`, {
    ...init,
    headers: {
      ...(sessionId ? { Cookie: cookie(sessionId) } : {}),
      ...init.headers,
    },
  });
const scenario = (id: string) => {
  const found = SCENARIOS.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown test scenario: ${id}`);
  return found;
};
const submit = async (sessionId: string, id: string) => {
  await ensureDemoSession(sessionId);
  return submitInvoice(sessionId, scenario(id).text, "test", mockProvider);
};
const manager = REVIEWERS.find((reviewer) => reviewer.role === "ap_manager");
const clerk = REVIEWERS.find((reviewer) => reviewer.role === "ap_clerk");
if (!manager || !clerk) throw new Error("Test reviewers are not configured");
const codes = (inv: Awaited<ReturnType<typeof submit>>) => inv.checks.flatMap((c) => c.findings.map((f) => f.code));

beforeEach(() => {
  resetLocalDemoData();
});

describe("demo session cookies and API authorization", () => {
  it("accepts only a high-entropy session cookie and rejects missing or forged values", () => {
    expect(sessionIdFromCookieHeader(`other=value; ${cookie(SESSION_A)}`)).toBe(SESSION_A);
    expect(sessionIdFromCookieHeader(null)).toBeNull();
    expect(sessionIdFromCookieHeader(`${DEMO_SESSION_COOKIE}=manager`)).toBeNull();
  });

  it("rejects API reads and writes without a valid session", async () => {
    expect((await getInvoices(request("/api/invoices"))).status).toBe(401);
    expect((await getAudit(request("/api/audit"))).status).toBe(401);
    expect((await verifyAudit(request("/api/audit/verify"))).status).toBe(401);
    expect((await submitScenarioRoute(request("/api/invoices", undefined, { method: "POST" }))).status).toBe(401);
    expect(
      (await getInvoiceRoute(request("/api/invoices/INV-0001"), { params: Promise.resolve({ id: "INV-0001" }) })).status,
    ).toBe(401);
    expect((await changeReviewerRoute(request("/api/reviewer", undefined, { method: "POST" }))).status).toBe(401);
    expect((await resetRoute(request("/api/demo/reset", undefined, { method: "POST" }))).status).toBe(401);
    expect(
      (await decisionRoute(request("/api/invoices/INV-0001/decision", undefined, { method: "POST" }), {
        params: Promise.resolve({ id: "INV-0001" }),
      })).status,
    ).toBe(401);
  });

  it("rejects free-form invoice text and accepts only canonical server fixtures", async () => {
    const arbitrary = await submitScenarioRoute(
      request("/api/invoices", SESSION_A, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: "real bank account 1234567890" }),
      }),
    );
    expect(arbitrary.status).toBe(400);
    expect(listInvoices(SESSION_A)).toHaveLength(0);

    const forgedFixture = await submitScenarioRoute(
      request("/api/invoices", SESSION_A, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: "clean", rawText: "replace with private invoice" }),
      }),
    );
    expect(forgedFixture.status).toBe(400);

    const accepted = await submitScenarioRoute(
      request("/api/invoices", SESSION_A, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: "clean" }),
      }),
    );
    expect(accepted.status).toBe(201);
    const invoice = (await accepted.json()) as { id: string; rawText: string };
    expect(invoice.rawText).toBe(scenario("clean").text);
  });

  it("lists only the current visitor's invoices and audit history", async () => {
    const invA = await submit(SESSION_A, "bank");
    const invB = await submit(SESSION_B, "clean");
    const responseA = await getInvoices(request("/api/invoices", SESSION_A));
    const responseB = await getInvoices(request("/api/invoices", SESSION_B));
    const invoicesA = await responseA.json() as { id: string }[];
    const invoicesB = await responseB.json() as { id: string }[];
    expect(invoicesA.some((invoice) => invoice.id === invA.id)).toBe(true);
    expect(invoicesA.some((invoice) => invoice.id === invB.id)).toBe(false);
    expect(invoicesB.some((invoice) => invoice.id === invB.id)).toBe(true);
    expect(invoicesB.some((invoice) => invoice.id === invA.id)).toBe(false);

    const auditA = await (await getAudit(request("/api/audit", SESSION_A))).json() as { invoiceId: string | null }[];
    const auditB = await (await getAudit(request("/api/audit", SESSION_B))).json() as { invoiceId: string | null }[];
    expect(auditA.some((entry) => entry.invoiceId === invB.id)).toBe(false);
    expect(auditB.some((entry) => entry.invoiceId === invA.id)).toBe(false);
  });
});

describe("seven synthetic scenarios", () => {
  it("auto-clears a clean match", async () => {
    const inv = await submit(SESSION_A, "clean");
    expect(inv.status).toBe("cleared");
    expect(inv.explanation).toBeNull();
  });

  it.each([
    ["price", "PRICE_VARIANCE"],
    ["duplicate", "DUPLICATE_INVOICE"],
    ["bank", "BANK_DETAILS_CHANGED"],
    ["overbilled", "OVER_PO_BALANCE"],
    ["missing-po", "MISSING_FIELD"],
    ["inactive", "INACTIVE_VENDOR"],
  ])("routes %s to review with %s", async (id, code) => {
    const inv = await submit(SESSION_A, id);
    expect(inv.status).toBe("needs_review");
    expect(codes(inv)).toContain(code);
    expect(inv.explanation?.summary).toBeTruthy();
  });

  it("does not guess missing currency", async () => {
    await ensureDemoSession(SESSION_A);
    const text = scenario("clean").text.replaceAll("USD", "");
    const inv = await submitInvoice(SESSION_A, text, "test", mockProvider);
    expect(inv.status).toBe("needs_review");
    expect(codes(inv)).toContain("MISSING_FIELD");
    expect(inv.extracted?.currency).toBeNull();
  });

  it("checks total against line items when subtotal is absent", async () => {
    await ensureDemoSession(SESSION_A);
    const text = scenario("clean").text
      .replace(/^Subtotal:.*\n/m, "")
      .replace("Total Due: USD 4,815.00", "Total Due: USD 4,816.00");
    const inv = await submitInvoice(SESSION_A, text, "test", mockProvider);
    expect(inv.status).toBe("needs_review");
    expect(codes(inv)).toContain("TOTAL_MISMATCH");
  });

  it("does not infer due date from payment terms", async () => {
    await ensureDemoSession(SESSION_A);
    const text = scenario("missing-po").text.replace(/^Due date:.*\n/m, "");
    const inv = await submitInvoice(SESSION_A, text, "test", mockProvider);
    expect(inv.status).toBe("needs_review");
    expect(inv.extracted?.dueDate).toBeNull();
    expect(inv.checks.flatMap((c) => c.findings).some((f) => f.field === "dueDate")).toBe(true);
  });

  it("falls back to the mock for invalid provider output and records it in this session only", async () => {
    const invalidProvider: AIProvider = {
      id: "invalid-test",
      model: "unit-test",
      async extractInvoice() { return { vendorName: 42 }; },
      async explainExceptions() { return { recommendedAction: "pay" }; },
    };
    await ensureDemoSession(SESSION_A);
    const inv = await submitInvoice(SESSION_A, scenario("bank").text, "test", invalidProvider);
    expect(inv.status).toBe("needs_review");
    expect(inv.explanationBy).toBe("mock:mock-v1");
    expect(listAudit(SESSION_A, inv.id).filter((entry) => entry.action === "ai.fallback")).toHaveLength(2);
    expect(listAudit(SESSION_B)).toHaveLength(0);
  });
});

describe("session isolation and scoped reset", () => {
  it("keeps invoice text, records, and audit entries private between sessions", async () => {
    const invA = await submit(SESSION_A, "bank");
    const invB = await submit(SESSION_B, "clean");

    expect(getInvoice(invA.id, SESSION_A)?.rawText).toBe(scenario("bank").text);
    expect(getInvoice(invA.id, SESSION_B)).toBeNull();
    expect(listInvoices(SESSION_A).some((row) => row.id === invB.id)).toBe(false);
    expect(listInvoices(SESSION_B).some((row) => row.id === invA.id)).toBe(false);
    expect(listAudit(SESSION_A, invB.id)).toHaveLength(0);
    expect(listAudit(SESSION_B, invA.id)).toHaveLength(0);

    const response = await getInvoiceRoute(request(`/api/invoices/${invA.id}`, SESSION_B), {
      params: Promise.resolve({ id: invA.id }),
    });
    expect(response.status).toBe(404);
  });

  it("resets only the caller's session and starts a valid new audit chain", async () => {
    const invA = await submit(SESSION_A, "bank");
    await submit(SESSION_B, "overbilled");
    const bAuditBefore = listAudit(SESSION_B);

    const response = await resetRoute(request("/api/demo/reset", SESSION_A, { method: "POST" }));
    expect(response.status).toBe(200);
    expect(listInvoices(SESSION_A)).toHaveLength(4);
    expect(listInvoices(SESSION_A).some((row) => row.id === invA.id)).toBe(false);
    expect(listInvoices(SESSION_B)).toHaveLength(5);
    expect(listAudit(SESSION_B).map((entry) => entry.hash)).toEqual(bAuditBefore.map((entry) => entry.hash));
    expect(listAudit(SESSION_A).at(-1)?.action).toBe("demo.session_reset");
    expect(verifyAuditChain(SESSION_A).ok).toBe(true);
    expect(verifyAuditChain(SESSION_B).ok).toBe(true);
  });

  it("ignores any attempted target session in a reset request body", async () => {
    const invA = await submit(SESSION_A, "bank");
    const invB = await submit(SESSION_B, "clean");
    const response = await resetRoute(
      request("/api/demo/reset", SESSION_B, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: SESSION_A }),
      }),
    );
    expect(response.status).toBe(200);
    expect(getInvoice(invA.id, SESSION_A)).not.toBeNull();
    expect(getInvoice(invB.id, SESSION_B)).toBeNull();
    expect(verifyAuditChain(SESSION_A).ok).toBe(true);
    expect(verifyAuditChain(SESSION_B).ok).toBe(true);
  });

  it("switches simulated personas only within the caller's session and audits the switch", async () => {
    await ensureDemoSession(SESSION_A);
    await ensureDemoSession(SESSION_B);
    const response = await changeReviewerRoute(
      request("/api/reviewer", SESSION_A, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "dana" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(currentReviewer(SESSION_A).role).toBe("ap_manager");
    expect(currentReviewer(SESSION_B).role).toBe("ap_clerk");
    expect(listAudit(SESSION_A).some((entry) => entry.action === "demo.persona_changed")).toBe(true);
    expect(listAudit(SESSION_B).some((entry) => entry.action === "demo.persona_changed")).toBe(false);
  });

  it("seeds one starter set when multiple first requests arrive together", async () => {
    await Promise.all(Array.from({ length: 10 }, () => ensureDemoSession(SESSION_A)));
    expect(listInvoices(SESSION_A)).toHaveLength(4);
    expect(listAudit(SESSION_A).filter((entry) => entry.action === "demo.session_initialized")).toHaveLength(1);
  });

  it("blocks the developer-wide reset command in production mode", async () => {
    await submit(SESSION_A, "bank");
    const previous = process.env.NODE_ENV;
    Reflect.set(process.env, "NODE_ENV", "production");
    try {
      expect(() => resetLocalDemoData()).toThrow("The global demo reset is disabled in production");
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
      else Reflect.set(process.env, "NODE_ENV", previous);
    }
    expect(listInvoices(SESSION_A).some((invoice) => invoice.extracted?.invoiceNumber === "MLE-2291")).toBe(true);
  });
});

describe("human decisions", () => {
  it("correcting the missing PO re-runs checks and clears", async () => {
    const inv = await submit(SESSION_A, "missing-po");
    const after = await decide(inv.id, SESSION_A, { action: "correct", reason: "PO found in order history", corrections: { poNumber: "po-10025" } }, clerk, mockProvider);
    expect(after.extracted?.poNumber).toBe("PO-10025");
    expect(after.status).toBe("cleared");
  });

  it("rejects invalid date corrections without changing the invoice", async () => {
    const inv = await submit(SESSION_A, "missing-po");
    await expect(
      decide(inv.id, SESSION_A, { action: "correct", reason: "Trying an invalid invoice date", corrections: { invoiceDate: "2026-02-30" } }, clerk, mockProvider),
    ).rejects.toMatchObject({ status: 400 });
    expect(getInvoice(inv.id, SESSION_A)?.status).toBe("needs_review");
  });

  it("enforces high-value approval on the server using the session's simulated role", async () => {
    const inv = await submit(SESSION_A, "duplicate");
    await expect(decide(inv.id, SESSION_A, { action: "approve", reason: "Looks fine to me" }, clerk, mockProvider)).rejects.toBeInstanceOf(PipelineError);
    await changeReviewer(SESSION_A, manager.id);
    expect((await decide(inv.id, SESSION_A, { action: "approve", reason: "Vendor re-sent by mistake, ok" }, currentReviewer(SESSION_A), mockProvider)).status).toBe("approved");
  });

  it("rejects a caller-supplied reviewer role instead of trusting it", async () => {
    const inv = await submit(SESSION_A, "duplicate");
    const response = await decisionRoute(
      request(`/api/invoices/${inv.id}/decision`, SESSION_A, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", reason: "Pretend to be the manager", reviewer: "dana" }),
      }),
      { params: Promise.resolve({ id: inv.id }) },
    );
    expect(response.status).toBe(400);
    expect(getInvoice(inv.id, SESSION_A)?.status).toBe("needs_review");
  });

  it("cannot approve another session's invoice even with the manager persona", async () => {
    const invA = await submit(SESSION_A, "duplicate");
    await ensureDemoSession(SESSION_B);
    await changeReviewer(SESSION_B, manager.id);
    const response = await decisionRoute(
      request(`/api/invoices/${invA.id}/decision`, SESSION_B, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", reason: "Trying to reject another session" }),
      }),
      { params: Promise.resolve({ id: invA.id }) },
    );
    expect(response.status).toBe(404);
    await expect(
      decide(invA.id, SESSION_B, { action: "approve", reason: "Trying to reach another session" }, currentReviewer(SESSION_B), mockProvider),
    ).rejects.toMatchObject({ status: 404 });
    expect(getInvoice(invA.id, SESSION_A)?.status).toBe("needs_review");
  });

  it("requires a manager when the extracted total is unknown", async () => {
    await ensureDemoSession(SESSION_A);
    const text = scenario("bank").text.replace(/Total Due: USD [\d,]+\.\d{2}/, "Total Due: USD not stated");
    const inv = await submitInvoice(SESSION_A, text, "test", mockProvider);
    expect(inv.extracted?.total).toBeNull();
    await expect(
      decide(inv.id, SESSION_A, { action: "approve", reason: "Approved after manual amount check" }, clerk, mockProvider),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("cannot decide an invoice twice", async () => {
    const inv = await submit(SESSION_A, "bank");
    await decide(inv.id, SESSION_A, { action: "reject", reason: "Suspected fraud" }, clerk, mockProvider);
    await expect(decide(inv.id, SESSION_A, { action: "reject", reason: "Again" }, clerk, mockProvider)).rejects.toMatchObject({ status: 409 });
  });
});

describe("audit integrity", () => {
  it("records each workflow step and verifies independent chains", async () => {
    const invA = await submit(SESSION_A, "bank");
    const invB = await submit(SESSION_B, "bank");
    await decide(invA.id, SESSION_A, { action: "reject", reason: "Suspected fraud" }, clerk, mockProvider);

    expect(listAudit(SESSION_A, invA.id).map((entry) => entry.action)).toEqual([
      "invoice.received", "ai.extracted", "rules.evaluated", "ai.explained", "invoice.routed", "review.rejected",
    ]);
    expect(verifyAuditChain(SESSION_A).ok).toBe(true);
    expect(verifyAuditChain(SESSION_B).ok).toBe(true);
    expect(listAudit(SESSION_B, invA.id)).toHaveLength(0);
    expect(listAudit(SESSION_B, invB.id).length).toBeGreaterThan(0);
  });

  it("detects tampering within a visitor's own chain", async () => {
    const inv = await submit(SESSION_A, "clean");
    getDb().prepare("UPDATE audit_log SET summary = 'edited' WHERE session_id = ? AND invoice_id = ? AND action = 'rules.evaluated'").run(SESSION_A, inv.id);
    expect(verifyAuditChain(SESSION_A).ok).toBe(false);
    expect(verifyAuditChain(SESSION_B).ok).toBe(true);
  });
});
