import { getDb } from "./db";
import { mockProvider } from "./ai/provider";
import { appendAudit } from "./audit";
import { submitInvoice } from "./pipeline";
import { HISTORY, renderInvoice, SCENARIOS } from "./samples";

const VENDORS = [
  ["V-001", "Northwind Industrial Supply Co.", ["Northwind Industrial", "Northwind Industrial Supply"], "active", "4417", "Net 30"],
  ["V-002", "Helix Cloud Services Inc.", ["Helix Cloud"], "active", "9082", "Net 30"],
  ["V-003", "Brightline Logistics LLC", ["Brightline Logistics"], "active", "2236", "Net 15"],
  ["V-004", "Orbit Office Furnishings", ["Orbit Furnishings"], "active", "7715", "Net 30"],
  ["V-005", "Meridian Lab Equipment", ["Meridian Lab"], "active", "3390", "Net 30"],
  ["V-006", "Cascade Print & Packaging", ["Cascade Print"], "inactive", "5521", "Net 30"],
] as const;

const POS: [string, string, string, string, [string, string, number, number][]][] = [
  ["PO-10021", "V-001", "open", "2026-08-12", [["HV-200", "Hydraulic valve assembly", 20, 450], ["GSK-14", "Gasket kit", 50, 32.5]]],
  ["PO-10022", "V-002", "open", "2026-08-20", [["CLD-ENT", "Cloud platform seat licenses", 40, 1200], ["CLD-SUP", "Premium support plan", 1, 6000]]],
  ["PO-10023", "V-003", "open", "2026-08-25", [["FRT-LTL", "Freight LTL shipment", 12, 840]]],
  ["PO-10024", "V-004", "open", "2026-09-01", [["DSK-ST", "Standing desk", 15, 689], ["CHR-ERG", "Ergonomic chair", 15, 412]]],
  ["PO-10025", "V-005", "open", "2026-09-05", [["CNT-MC", "Microcentrifuge", 4, 2350], ["PIP-SET", "Pipette set", 10, 285]]],
  ["PO-10026", "V-001", "closed", "2026-03-10", [["BRG-62", "Bearing 6205", 200, 12.4]]],
  ["PO-10027", "V-006", "open", "2026-06-15", [["PKG-BX", "Shipping carton", 5000, 1.15]]],
];

export function resetData() {
  const db = getDb();
  const addVendor = db.prepare("INSERT INTO vendors VALUES (?,?,?,?,?,?)");
  const addPo = db.prepare("INSERT INTO purchase_orders VALUES (?,?,?,?,?)");
  const addLine = db.prepare("INSERT INTO po_lines (po_number, sku, description, quantity, unit_price) VALUES (?,?,?,?,?)");
  db.transaction(() => {
    for (const t of ["audit_log", "reviews", "invoices", "po_lines", "purchase_orders", "vendors"]) db.exec(`DELETE FROM ${t}`);
    db.exec("DELETE FROM sqlite_sequence");
    for (const v of VENDORS) addVendor.run(v[0], v[1], JSON.stringify(v[2]), v[3], v[4], v[5]);
    for (const [num, vendor, status, issued, lines] of POS) {
      addPo.run(num, vendor, status, "USD", issued);
      for (const l of lines) addLine.run(num, ...l);
    }
  })();
}

export async function seedDemo() {
  resetData();
  appendAudit({ invoiceId: null, actorType: "system", actor: "seed", action: "system.seeded", summary: "Demo reference data loaded (6 vendors, 7 purchase orders)" });
  // History goes through the real pipeline with the mock provider, so its audit trail is genuine.
  for (const h of HISTORY) await submitInvoice(renderInvoice(h), "email", mockProvider);
  const starterReview = SCENARIOS.find((scenario) => scenario.id === "price");
  if (!starterReview) throw new Error("The seeded price-variance scenario is missing");
  await submitInvoice(starterReview.text, "email", mockProvider);
}

export function isEmpty() {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM vendors").get() as { n: number }).n === 0;
}
