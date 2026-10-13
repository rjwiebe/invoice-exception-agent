import { getDb } from "./db";
import type { Check, Explanation, Extracted, Invoice, InvoiceStatus, PriorInvoice, PurchaseOrder, Vendor } from "./types";

export function getVendors(): Vendor[] {
  const rows = getDb().prepare("SELECT * FROM vendors ORDER BY id").all() as Record<string, string>[];
  return rows.map((r) => ({
    id: r.id, name: r.name, aliases: JSON.parse(r.aliases), status: r.status as Vendor["status"],
    bankLast4: r.bank_last4, paymentTerms: r.payment_terms,
  }));
}

export function getPurchaseOrders(): PurchaseOrder[] {
  const db = getDb();
  const pos = db.prepare("SELECT * FROM purchase_orders ORDER BY number").all() as Record<string, string>[];
  const lines = db.prepare("SELECT * FROM po_lines ORDER BY id").all() as Record<string, string | number>[];
  return pos.map((p) => ({
    number: p.number, vendorId: p.vendor_id, status: p.status as PurchaseOrder["status"], currency: p.currency, issuedOn: p.issued_on,
    lines: lines
      .filter((l) => l.po_number === p.number)
      .map((l) => ({ sku: l.sku as string, description: l.description as string, quantity: l.quantity as number, unitPrice: l.unit_price as number })),
  }));
}

type Row = Record<string, string | null>;

const toInvoice = (r: Row): Invoice => ({
  id: r.id!, source: r.source!, rawText: r.raw_text!, status: r.status as InvoiceStatus, vendorId: r.vendor_id,
  extracted: r.extracted_json ? (JSON.parse(r.extracted_json) as Extracted) : null,
  checks: JSON.parse(r.checks_json!) as Check[],
  explanation: r.explanation_json ? (JSON.parse(r.explanation_json) as Explanation) : null,
  explanationBy: r.explanation_by, extractedBy: r.extracted_by,
  resolvedBy: r.resolved_by, resolvedReason: r.resolved_reason, resolvedAt: r.resolved_at,
  createdAt: r.created_at!, updatedAt: r.updated_at!,
});

export function getInvoice(id: string, sessionId: string): Invoice | null {
  const r = getDb().prepare("SELECT * FROM invoices WHERE id = ? AND session_id = ?").get(id, sessionId) as Row | undefined;
  return r ? toInvoice(r) : null;
}

export function listInvoices(sessionId: string, status?: string): Invoice[] {
  const db = getDb();
  const rows = (status
    ? db.prepare("SELECT * FROM invoices WHERE session_id = ? AND status = ? ORDER BY created_at DESC").all(sessionId, status)
    : db.prepare("SELECT * FROM invoices WHERE session_id = ? ORDER BY created_at DESC").all(sessionId)) as Row[];
  return rows.map(toInvoice);
}

export function priorInvoices(sessionId: string, excludeId: string): PriorInvoice[] {
  return listInvoices(sessionId)
    .filter((i) => i.id !== excludeId && i.status !== "processing")
    .map((i) => ({
      id: i.id, vendorId: i.vendorId, invoiceNumber: i.extracted?.invoiceNumber ?? null,
      poNumber: i.extracted?.poNumber ?? null,
      subtotal: i.extracted ? (i.extracted.subtotal ?? i.extracted.lineItems.reduce((s, l) => s + l.amount, 0)) : null,
      status: i.status,
    }));
}

export function newInvoiceId(): string {
  const row = getDb()
    .prepare("UPDATE invoice_id_sequence SET value = value + 1 WHERE name = 'invoice' RETURNING value")
    .get() as { value: number } | undefined;
  if (!row) throw new Error("Invoice ID sequence is not initialized");
  return `INV-${String(row.value).padStart(4, "0")}`;
}
