import type { Explanation, Extracted, RecommendedAction } from "../types";
import type { AIProvider, ExplainInput } from "./provider";

const num = (s: string) => parseFloat(s.replace(/,/g, ""));
const AMT = String.raw`\$?\s*([\d,]+\.\d{2})`;

function toIso(s: string): string | null {
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const normalized = iso ? s : us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : null;
  if (!normalized) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === normalized ? normalized : null;
}

// Deterministic stand-in for an LLM. It reads layout cues with regexes, which is
// exactly the brittle approach a real model replaces. Same interface, same schema.
export class MockProvider implements AIProvider {
  id = "mock";
  model = "mock-v1";

  async extractInvoice(rawText: string): Promise<Extracted> {
    const text = rawText.replace(/\r/g, "");
    const lines = text.split("\n").map((l) => l.trim());
    const find = (re: RegExp) => text.match(re)?.[1] ?? null;

    const invoiceDateRaw = find(/(?<!due\s)(?:invoice\s*date|dated|date)\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i);
    let invoiceDate = invoiceDateRaw ? toIso(invoiceDateRaw) : null;
    const dueRaw = find(/due\s*date\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i);
    let dueDate = dueRaw ? toIso(dueRaw) : null;
    const lineItems: Extracted["lineItems"] = [];
    for (const l of lines) {
      const a = l.match(new RegExp(String.raw`^(\d+)\s+(.+?)\s{2,}${AMT}\s+${AMT}$`));
      const b = l.match(new RegExp(String.raw`^(\d+)\s*x\s+(.+?)\s+@\s*${AMT}\s*=\s*${AMT}$`, "i"));
      const m = a ?? b;
      if (m) lineItems.push({ quantity: parseInt(m[1], 10), description: m[2].trim(), unitPrice: num(m[3]), amount: num(m[4]) });
    }

    const subtotal = find(new RegExp(String.raw`^sub-?\s?total\b[^\n\d$]*${AMT}`, "im"));
    const tax = find(new RegExp(String.raw`^(?:sales\s+)?tax\b[^\n]*?${AMT}\s*$`, "im"));
    const total = find(new RegExp(String.raw`^(?:total due|amount due|total amount|total)\b[^\n\d$]*${AMT}`, "im"));

    const data: Extracted = {
      vendorName: lines.find((l) => l.length > 0) ?? null,
      invoiceNumber: find(/(?:invoice\s*(?:no\.?|number|#)|\binv\b\.?\s*#?)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]+)/i),
      invoiceDate,
      dueDate,
      poNumber: find(/\b(PO-\d{3,})\b/i)?.toUpperCase() ?? null,
      currency: find(/\b(USD|EUR|GBP|CAD)\b/),
      lineItems,
      subtotal: subtotal ? num(subtotal) : null,
      tax: tax ? num(tax) : null,
      total: total ? num(total) : null,
      bankLast4: find(/(?:ending|\*{2,4})\s*(\d{4})/i),
    };
    return data;
  }

  async explainExceptions({ invoice, vendorName, findings }: ExplainInput): Promise<Explanation> {
    const codes = new Set(findings.map((f) => f.code));
    const has = (...c: string[]) => c.some((x) => codes.has(x));
    const who = vendorName ?? invoice.vendorName ?? "an unknown vendor";
    const primaryFindings = findings.filter((finding) => !finding.relatedTo);
    const supportingFindings = findings.filter((finding) => finding.relatedTo);
    const count = primaryFindings.length || findings.length;

    const summary =
      `Invoice ${invoice.invoiceNumber ?? "(number not found)"} from ${who} was held for review because ${count === 1 ? "one exception needs" : `${count} exceptions need`} review. ` +
      `${primaryFindings.map((f) => f.message).join(" ") || findings.map((f) => f.message).join(" ")}` +
      (supportingFindings.length ? ` Supporting evidence: ${supportingFindings.map((f) => f.message).join(" ")}` : "");

    let recommendedAction: RecommendedAction;
    let rationale: string;
    if (has("BANK_DETAILS_CHANGED")) {
      recommendedAction = "reject";
      rationale = "Changed bank details on an otherwise normal invoice is the classic payment-redirection fraud pattern. Reject, then confirm the new details with the vendor on a phone number already on file.";
    } else if (has("DUPLICATE_INVOICE")) {
      recommendedAction = "reject";
      rationale = "This invoice number was already received from the same vendor. Paying it again would be a duplicate payment.";
    } else if (has("UNKNOWN_VENDOR", "INACTIVE_VENDOR")) {
      recommendedAction = "reject";
      rationale = "Payments can only go to active vendors in the vendor master. Reject and have procurement review the vendor first.";
    } else if (has("MISSING_FIELD", "PO_NOT_FOUND", "PO_VENDOR_MISMATCH")) {
      recommendedAction = "correct";
      rationale = "The invoice can't be matched because a key reference is missing or wrong. If you can identify the right PO from the vendor's order history, correct the field and the checks will re-run.";
    } else if (findings.every((f) => f.severity === "warning")) {
      recommendedAction = "approve";
      rationale = "Only minor variances were found and none look risky. Approving with a short note is reasonable.";
    } else {
      recommendedAction = "reject";
      rationale = "The amounts exceed what the PO authorised. Reject and ask the vendor for a credit memo or corrected invoice, or have the PO amended first.";
    }
    return { summary, recommendedAction, rationale };
  }
}
