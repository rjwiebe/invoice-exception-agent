import { round2 } from "./format";

export interface InvoiceSpec {
  style: "A" | "B";
  vendor: string;
  number: string;
  date: string; // yyyy-mm-dd
  dueDays: number;
  po?: string;
  lines: { desc: string; qty: number; price: number }[];
  taxRate: number;
  bank: string;
}

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const addDays = (iso: string, d: number) => {
  const x = new Date(`${iso}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};

// Renders synthetic invoice text in one of two layouts, the way different vendors' PDFs/emails would look after OCR.
export function renderInvoice(s: InvoiceSpec): string {
  const subtotal = round2(s.lines.reduce((t, l) => t + l.qty * l.price, 0));
  const tax = round2(subtotal * s.taxRate);
  const total = round2(subtotal + tax);
  const due = addDays(s.date, s.dueDays);

  if (s.style === "A") {
    const rows = s.lines.map((l) => `${String(l.qty).padEnd(4)} ${l.desc.padEnd(40)}  ${fmt(l.price).padStart(10)}  ${fmt(round2(l.qty * l.price)).padStart(12)}`);
    return [
      s.vendor.toUpperCase(), "INVOICE", `Invoice No: ${s.number}`, `Invoice Date: ${s.date}`, `Due Date: ${due}`,
      ...(s.po ? [`PO Reference: ${s.po}`] : []), "Currency: USD", "",
      "QTY  DESCRIPTION                                UNIT PRICE        AMOUNT", ...rows, "",
      `Subtotal: ${fmt(subtotal)}`, `Tax (${(s.taxRate * 100).toFixed(1)}%): ${fmt(tax)}`, `Total Due: USD ${fmt(total)}`, "",
      `Remit to: ACH acct ending ${s.bank}`,
    ].join("\n");
  }
  const [y, m, d] = s.date.split("-");
  const [dueY, dueM, dueD] = due.split("-");
  const rows = s.lines.map((l) => `${l.qty} x ${l.desc} @ $${fmt(l.price)} = $${fmt(round2(l.qty * l.price))}`);
  return [
    s.vendor, `Inv # ${s.number} | dated ${m}/${d}/${y}`, `Due date: ${dueM}/${dueD}/${dueY}`, `Terms: Net ${s.dueDays}`,
    ...(s.po ? [`Re: ${s.po}`] : ["Re: your recent order"]), "", ...rows, "",
    `Sub-total $${fmt(subtotal)}`, `Sales tax $${fmt(tax)}`, `AMOUNT DUE (USD) $${fmt(total)}`, "",
    `Payment: wire to account ****${s.bank}`,
  ].join("\n");
}

// Already-processed invoices that exist in the system before the demo starts.
export const HISTORY: InvoiceSpec[] = [
  { style: "A", vendor: "Helix Cloud Services Inc.", number: "HX-5503", date: "2026-09-02", dueDays: 30, po: "PO-10022", lines: [{ desc: "CLD-ENT Cloud platform seat licenses", qty: 40, price: 1200 }], taxRate: 0, bank: "9082" },
  { style: "B", vendor: "Brightline Logistics LLC", number: "BL-3301", date: "2026-09-09", dueDays: 15, po: "PO-10023", lines: [{ desc: "FRT-LTL Freight LTL shipment", qty: 4, price: 840 }], taxRate: 0, bank: "2236" },
  { style: "A", vendor: "Northwind Industrial Supply Co.", number: "NW-87904", date: "2026-09-14", dueDays: 30, po: "PO-10021", lines: [{ desc: "GSK-14 Gasket kit", qty: 10, price: 32.5 }], taxRate: 0.07, bank: "4417" },
];

export interface Scenario {
  id: string;
  title: string;
  blurb: string;
  expected: string;
  text: string;
}

const spec = (s: InvoiceSpec) => renderInvoice(s);

export const SCENARIOS: Scenario[] = [
  {
    id: "clean", title: "Clean match", expected: "Auto-cleared for payment",
    blurb: "Northwind bills 10 valves at the PO price. Nothing to flag.",
    text: spec({ style: "A", vendor: "Northwind Industrial Supply Co.", number: "NW-88231", date: "2026-09-28", dueDays: 30, po: "PO-10021", lines: [{ desc: "HV-200 Hydraulic valve assembly", qty: 10, price: 450 }], taxRate: 0.07, bank: "4417" }),
  },
  {
    id: "price", title: "Price creep", expected: "Review: price variance",
    blurb: "Orbit raises the standing desk price about 6% above the PO.",
    text: spec({ style: "B", vendor: "Orbit Office Furnishings", number: "OF-1187", date: "2026-09-25", dueDays: 30, po: "PO-10024", lines: [{ desc: "DSK-ST Standing desk", qty: 15, price: 729 }, { desc: "CHR-ERG Ergonomic chair", qty: 15, price: 412 }], taxRate: 0.0825, bank: "7715" }),
  },
  {
    id: "duplicate", title: "Duplicate invoice", expected: "Review: duplicate",
    blurb: "Helix sends HX-5503 again. The earlier invoice was cleared for payment.",
    text: spec(HISTORY[0]),
  },
  {
    id: "bank", title: "Changed bank details", expected: "Review: possible fraud",
    blurb: "Meridian's invoice is otherwise perfect, but the remit-to account changed.",
    text: spec({ style: "A", vendor: "Meridian Lab Equipment", number: "MLE-2291", date: "2026-09-30", dueDays: 30, po: "PO-10025", lines: [{ desc: "CNT-MC Microcentrifuge", qty: 4, price: 2350 }], taxRate: 0.06, bank: "8841" }),
  },
  {
    id: "overbilled", title: "Bills more than the PO has left", expected: "Review: over PO balance",
    blurb: "Brightline invoices 10 freight runs, but only 8 are left on the PO.",
    text: spec({ style: "A", vendor: "Brightline Logistics LLC", number: "BL-3390", date: "2026-10-01", dueDays: 15, po: "PO-10023", lines: [{ desc: "FRT-LTL Freight LTL shipment", qty: 10, price: 840 }], taxRate: 0, bank: "2236" }),
  },
  {
    id: "missing-po", title: "Missing PO number", expected: "Review: fix, then clears",
    blurb: "A messy email-style invoice with no PO. Correct it and the checks re-run.",
    text: spec({ style: "B", vendor: "Meridian Lab Equipment", number: "MLE-2305", date: "2026-10-02", dueDays: 30, lines: [{ desc: "PIP-SET Pipette set", qty: 10, price: 285 }], taxRate: 0.06, bank: "3390" }),
  },
  {
    id: "inactive", title: "Inactive vendor", expected: "Review: vendor offboarded",
    blurb: "Cascade Print was offboarded last quarter but still invoices.",
    text: spec({ style: "A", vendor: "Cascade Print & Packaging", number: "CP-4410", date: "2026-10-03", dueDays: 30, po: "PO-10027", lines: [{ desc: "PKG-BX Shipping carton", qty: 2000, price: 1.15 }], taxRate: 0.05, bank: "5521" }),
  },
];
