import { money, round2 } from "./format";
import type { Check, Extracted, Finding, PriorInvoice, PurchaseOrder, Severity, Vendor } from "./types";

// Pure and deterministic: same input, same output. No database, no AI, no clock.
// Every business decision about an invoice lives here so it can be unit-tested and audited.
export const RULESET_VERSION = "rules-v2";

export const POLICY = {
  priceWarnPct: 0.005, // below this, a unit-price difference is rounding noise
  priceErrorPct: 0.05, // above this, a unit-price difference is an error
  balanceTolerancePct: 0.02, // allowed overrun of the PO's remaining balance
  mathTolerance: 0.011,
};

export interface RuleContext {
  vendors: Vendor[];
  purchaseOrders: PurchaseOrder[];
  otherInvoices: PriorInvoice[]; // every invoice except the one being evaluated
}

export interface Evaluation {
  checks: Check[];
  findings: Finding[];
  vendorId: string | null;
  cleared: boolean;
}

const normalize = (s: string) =>
  s.toLowerCase().replace(/[.,&]/g, "").replace(/\b(inc|llc|co|corp|company|ltd)\b/g, "").replace(/\s+/g, " ").trim();

export function resolveVendor(name: string, vendors: Vendor[]): Vendor | undefined {
  const n = normalize(name);
  return vendors.find((v) => [v.name, ...v.aliases].some((a) => normalize(a) === n));
}

export const poTotal = (po: PurchaseOrder) => round2(po.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function evaluateInvoice(inv: Extracted, ctx: RuleContext): Evaluation {
  const checks: Check[] = [];
  const add = (id: string, label: string, findings: Finding[], skipped = false) => {
    const status = skipped
      ? "skipped"
      : findings.some((f) => f.severity === "error")
        ? "fail"
        : findings.length
          ? "warning"
          : "pass";
    checks.push({ id, label, status, findings: skipped ? [] : findings });
  };
  const F = (code: string, severity: Severity, message: string, extra: Partial<Finding> = {}): Finding => ({
    code, severity, message, ...extra,
  });

  // 1. Required fields
  const missing: Finding[] = [];
  const need = (ok: boolean, field: string, label: string) =>
    ok || missing.push(F("MISSING_FIELD", "error", `Could not find the ${label} on the invoice.`, { field }));
  need(!!inv.vendorName, "vendorName", "vendor name");
  need(!!inv.invoiceNumber, "invoiceNumber", "invoice number");
  need(!!inv.poNumber, "poNumber", "PO number");
  need(!!inv.currency, "currency", "currency");
  need(!!inv.invoiceDate, "invoiceDate", "invoice date");
  need(!!inv.dueDate, "dueDate", "due date");
  need(inv.total != null, "total", "total amount");
  need(inv.lineItems.length > 0, "lineItems", "line items");
  add("fields", "Required fields present", missing);

  // 2. Vendor
  const vendor = inv.vendorName ? resolveVendor(inv.vendorName, ctx.vendors) : undefined;
  const vendorFindings: Finding[] = [];
  if (inv.vendorName && !vendor)
    vendorFindings.push(F("UNKNOWN_VENDOR", "error", `"${inv.vendorName}" is not in the vendor master.`, { field: "vendorName", actual: inv.vendorName }));
  else if (vendor && vendor.status !== "active")
    vendorFindings.push(F("INACTIVE_VENDOR", "error", `${vendor.name} is marked inactive in the vendor master, so no new payments are allowed.`, { field: "vendorName" }));
  add("vendor", "Vendor is active in vendor master", vendorFindings, !inv.vendorName);

  // 3. Duplicate
  const dupFindings: Finding[] = [];
  const dup =
    vendor && inv.invoiceNumber
      ? ctx.otherInvoices.find(
          (o) => o.vendorId === vendor.id && o.invoiceNumber?.toLowerCase() === inv.invoiceNumber!.toLowerCase() && o.status !== "rejected",
        )
      : undefined;
  if (dup)
    dupFindings.push(F("DUPLICATE_INVOICE", "error", `Invoice ${inv.invoiceNumber} from ${vendor!.name} was already received (${dup.id}, status: ${dup.status}).`, { field: "invoiceNumber", actual: inv.invoiceNumber! }));
  add("duplicate", "Not a duplicate invoice", dupFindings, !vendor || !inv.invoiceNumber);

  // 4. PO lookup
  const po = inv.poNumber ? ctx.purchaseOrders.find((p) => p.number.toLowerCase() === inv.poNumber!.toLowerCase()) : undefined;
  add(
    "po",
    "PO exists",
    inv.poNumber && !po ? [F("PO_NOT_FOUND", "error", `PO ${inv.poNumber} does not exist.`, { field: "poNumber", actual: inv.poNumber })] : [],
    !inv.poNumber,
  );
  add(
    "po_vendor",
    "PO belongs to this vendor",
    po && vendor && po.vendorId !== vendor.id
      ? [F("PO_VENDOR_MISMATCH", "error", `${po.number} was issued to a different vendor than ${vendor.name}.`, { field: "poNumber" })]
      : [],
    !po || !vendor,
  );
  add(
    "po_open",
    "PO is open",
    po && po.status !== "open" ? [F("PO_CLOSED", "error", `${po.number} is closed and cannot receive invoices.`, { field: "poNumber" })] : [],
    !po,
  );
  add(
    "currency",
    "Currency matches PO",
    po && inv.currency && po.currency !== inv.currency
      ? [F("CURRENCY_MISMATCH", "error", `Invoice is in ${inv.currency} but the PO is in ${po.currency}.`, { field: "currency", expected: po.currency, actual: inv.currency })]
      : [],
    !po || !inv.currency,
  );

  // 5. Arithmetic
  const mathFindings: Finding[] = [];
  const linesSum = round2(inv.lineItems.reduce((s, l) => s + l.amount, 0));
  inv.lineItems.forEach((l) => {
    if (Math.abs(l.quantity * l.unitPrice - l.amount) > POLICY.mathTolerance)
      mathFindings.push(F("LINE_MATH", "error", `"${l.description}": ${l.quantity} × ${money(l.unitPrice)} is ${money(round2(l.quantity * l.unitPrice))}, not ${money(l.amount)}.`));
  });
  if (inv.subtotal != null && Math.abs(linesSum - inv.subtotal) > POLICY.mathTolerance)
    mathFindings.push(F("SUBTOTAL_MISMATCH", "error", `Line items add up to ${money(linesSum)} but the subtotal says ${money(inv.subtotal)}.`, { field: "subtotal", expected: money(linesSum), actual: money(inv.subtotal) }));
  if (inv.total != null && inv.lineItems.length > 0) {
    const subtotal = inv.subtotal ?? linesSum;
    const calc = round2(subtotal + (inv.tax ?? 0));
    if (Math.abs(calc - inv.total) > POLICY.mathTolerance)
      mathFindings.push(F("TOTAL_MISMATCH", "error", `${inv.subtotal == null ? "Line items" : "Subtotal"} + tax is ${money(calc)} but the invoice total says ${money(inv.total)}.`, { field: "total", expected: money(calc), actual: money(inv.total) }));
  }
  add("math", "Arithmetic is consistent", mathFindings, inv.lineItems.length === 0 || inv.total == null);

  // 6. Lines vs PO
  const matched = inv.lineItems.map((l) => {
    const d = l.description.toLowerCase();
    return { line: l, poLine: po?.lines.find((p) => d.includes(p.sku.toLowerCase())) };
  });
  add(
    "lines",
    "Every line item is on the PO",
    (po ? matched.filter((m) => !m.poLine) : []).map((m) => F("LINE_NOT_ON_PO", "error", `"${m.line.description}" is not a line item on ${po?.number}.`)),
    !po || inv.lineItems.length === 0,
  );

  const priceFindings: Finding[] = [];
  const qtyFindings: Finding[] = [];
  for (const { line, poLine } of matched) {
    if (!poLine) continue;
    const diff = (line.unitPrice - poLine.unitPrice) / poLine.unitPrice;
    if (Math.abs(diff) > POLICY.priceWarnPct)
      priceFindings.push(
        F(
          "PRICE_VARIANCE",
          Math.abs(diff) > POLICY.priceErrorPct ? "error" : "warning",
          `${poLine.sku} unit price is ${money(line.unitPrice)} vs ${money(poLine.unitPrice)} on the PO (${diff > 0 ? "+" : ""}${pct(diff)}).`,
          { field: "lineItems", expected: money(poLine.unitPrice), actual: money(line.unitPrice) },
        ),
      );
    if (line.quantity > poLine.quantity)
      qtyFindings.push(F("QUANTITY_EXCEEDS_PO", "error", `${poLine.sku}: invoiced ${line.quantity} but the PO only ordered ${poLine.quantity}.`, { expected: String(poLine.quantity), actual: String(line.quantity) }));
  }
  const unitPriceVariance = round2(
    matched.reduce((sum, { line, poLine }) => sum + (poLine ? line.quantity * (line.unitPrice - poLine.unitPrice) : 0), 0),
  );
  add("prices", "Unit prices match PO", priceFindings, !po || inv.lineItems.length === 0);
  add("quantities", "Quantities within PO", qtyFindings, !po || inv.lineItems.length === 0);

  // 7. PO remaining balance (pre-tax)
  const balanceFindings: Finding[] = [];
  if (po) {
    const billed = round2(
      ctx.otherInvoices
        .filter((o) => o.poNumber?.toLowerCase() === po.number.toLowerCase() && (o.status === "cleared" || o.status === "approved"))
        .reduce((s, o) => s + (o.subtotal ?? 0), 0),
    );
    const remaining = round2(poTotal(po) - billed);
    const amount = inv.subtotal ?? linesSum;
    if (amount > remaining + 0.005) {
      const overrunAmount = round2(amount - remaining);
      const overrun = overrunAmount / Math.max(remaining, 1);
      const explainedByPriceVariance =
        priceFindings.length > 0 &&
        qtyFindings.length === 0 &&
        matched.length > 0 &&
        matched.every((match) => match.poLine) &&
        unitPriceVariance > 0 &&
        Math.abs(overrunAmount - unitPriceVariance) <= POLICY.mathTolerance;
      const priorBilled = billed > 0 ? `, ${money(billed)} already cleared for payment` : "";
      balanceFindings.push(
        F(
          "OVER_PO_BALANCE",
          overrun > POLICY.balanceTolerancePct ? "error" : "warning",
          explainedByPriceVariance
            ? `The same ${money(unitPriceVariance)} unit-price variance is the amount this invoice exceeds the remaining PO balance (${money(amount)} invoiced vs ${money(remaining)} remaining).`
            : `Invoice is ${money(amount)} before tax but only ${money(remaining)} remains on ${po.number} (${money(poTotal(po))} ordered${priorBilled}).`,
          {
            expected: money(remaining),
            actual: money(amount),
            ...(explainedByPriceVariance ? { relatedTo: "PRICE_VARIANCE" } : {}),
          },
        ),
      );
    }
  }
  add("balance", "Within PO remaining balance", balanceFindings, !po || (inv.lineItems.length === 0 && inv.subtotal == null));

  // 8. Bank details
  add(
    "bank",
    "Bank details match vendor on file",
    vendor && inv.bankLast4 && vendor.bankLast4 !== inv.bankLast4
      ? [F("BANK_DETAILS_CHANGED", "error", `Remit-to account ends in ${inv.bankLast4} but ${vendor.name} has ${vendor.bankLast4} on file. Changed bank details are a common fraud pattern.`, { field: "bankLast4", expected: vendor.bankLast4, actual: inv.bankLast4 })]
      : [],
    !vendor || !inv.bankLast4,
  );

  // 9. Dates
  add(
    "dates",
    "Dates are sensible",
    inv.invoiceDate && inv.dueDate && inv.dueDate < inv.invoiceDate
      ? [F("DUE_BEFORE_INVOICE", "warning", `Due date ${inv.dueDate} is before the invoice date ${inv.invoiceDate}.`, { field: "dueDate" })]
      : [],
    !inv.invoiceDate || !inv.dueDate,
  );

  const findings = checks.flatMap((c) => c.findings);
  return { checks, findings, vendorId: vendor?.id ?? null, cleared: findings.length === 0 };
}
