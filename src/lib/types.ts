import { z } from "zod";

const isoDateSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Expected a valid ISO date (yyyy-mm-dd)");

// What the AI extraction step must produce. Anything it can't find is null.
export const ExtractedSchema = z.object({
  vendorName: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceDate: isoDateSchema.nullable(),
  dueDate: isoDateSchema.nullable(),
  poNumber: z.string().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  lineItems: z.array(
    z.object({
      description: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      amount: z.number(),
    }),
  ),
  subtotal: z.number().nullable(),
  tax: z.number().nullable(),
  total: z.number().nullable(),
  bankLast4: z.string().regex(/^\d{4}$/).nullable(),
});
export type Extracted = z.infer<typeof ExtractedSchema>;

export const RECOMMENDED_ACTIONS = ["approve", "reject", "correct"] as const;
export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];

// What the AI explanation step must produce. It advises; it never decides.
export const ExplanationSchema = z.object({
  summary: z.string().min(1),
  recommendedAction: z.enum(RECOMMENDED_ACTIONS),
  rationale: z.string().min(1),
});
export type Explanation = z.infer<typeof ExplanationSchema>;

export type Severity = "error" | "warning";

export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  field?: string;
  expected?: string;
  actual?: string;
  relatedTo?: string;
}

export interface Check {
  id: string;
  label: string;
  status: "pass" | "warning" | "fail" | "skipped";
  findings: Finding[];
}

export interface Vendor {
  id: string;
  name: string;
  aliases: string[];
  status: "active" | "inactive";
  bankLast4: string;
  paymentTerms: string;
}

export interface POLine {
  sku: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface PurchaseOrder {
  number: string;
  vendorId: string;
  status: "open" | "closed";
  currency: string;
  issuedOn: string;
  lines: POLine[];
}

export type InvoiceStatus = "processing" | "cleared" | "needs_review" | "approved" | "rejected";

export interface PriorInvoice {
  id: string;
  vendorId: string | null;
  invoiceNumber: string | null;
  poNumber: string | null;
  subtotal: number | null;
  status: InvoiceStatus;
}

export interface Invoice {
  id: string;
  source: string;
  rawText: string;
  status: InvoiceStatus;
  vendorId: string | null;
  extracted: Extracted | null;
  checks: Check[];
  explanation: Explanation | null;
  explanationBy: string | null;
  extractedBy: string | null;
  resolvedBy: string | null;
  resolvedReason: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ActorType = "system" | "ai" | "human";

export interface AuditEntry {
  seq: number;
  invoiceId: string | null;
  ts: string;
  actorType: ActorType;
  actor: string;
  action: string;
  summary: string;
  details: unknown;
  prevHash: string;
  hash: string;
}

export interface Reviewer {
  id: string;
  name: string;
  role: "ap_clerk" | "ap_manager";
  title: string;
}
