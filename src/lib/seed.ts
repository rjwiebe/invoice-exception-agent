import { getDb } from "./db";
import { appendAudit } from "./audit";
import { mockProvider } from "./ai/provider";
import { submitInvoice } from "./pipeline";
import { HISTORY, renderInvoice, SCENARIOS } from "./samples";
import { isValidDemoSessionId } from "./session-id";

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

const sessionTasks = new Map<string, Promise<unknown>>();
const now = () => new Date().toISOString();

function withSessionLock<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
  const previous = sessionTasks.get(sessionId) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(work);
  sessionTasks.set(sessionId, task);
  return task.finally(() => {
    if (sessionTasks.get(sessionId) === task) sessionTasks.delete(sessionId);
  });
}

function assertSessionId(sessionId: string): void {
  if (!isValidDemoSessionId(sessionId)) throw new Error("A valid demo session ID is required");
}

function ensureSessionRow(sessionId: string): void {
  const ts = now();
  getDb()
    .prepare("INSERT OR IGNORE INTO demo_sessions (session_id, reviewer_id, seeded_at, created_at, updated_at) VALUES (?, 'sam', NULL, ?, ?)")
    .run(sessionId, ts, ts);
}

function deleteSessionRecords(sessionId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM reviews WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM audit_log WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM invoices WHERE session_id = ?").run(sessionId);
}

async function populateSession(sessionId: string, action: "demo.session_initialized" | "demo.session_reset"): Promise<void> {
  appendAudit(sessionId, {
    invoiceId: null,
    actorType: "system",
    actor: "demo-session",
    action,
    summary: action === "demo.session_reset"
      ? "This browser session's synthetic demo data was reset."
      : "Synthetic demo data initialized for this browser session.",
  });
  for (const invoice of HISTORY) {
    await submitInvoice(sessionId, renderInvoice(invoice), "synthetic demo history", mockProvider);
  }
  const starterReview = SCENARIOS.find((scenario) => scenario.id === "price");
  if (!starterReview) throw new Error("The seeded price-variance scenario is missing");
  // Give the inbox fixture its own invoice number so the selectable price scenario
  // demonstrates price variance rather than also looking like a duplicate.
  const starterText = starterReview.text.replace("OF-1187", "OF-1186");
  if (starterText === starterReview.text) throw new Error("The starter price fixture invoice number could not be made unique");
  await submitInvoice(sessionId, starterText, "synthetic demo fixture", mockProvider);
}

async function initializeSession(sessionId: string): Promise<void> {
  seedReferenceData();
  ensureSessionRow(sessionId);
  const row = getDb().prepare("SELECT seeded_at FROM demo_sessions WHERE session_id = ?").get(sessionId) as { seeded_at: string | null };
  if (row.seeded_at) return;

  const db = getDb();
  db.transaction(() => deleteSessionRecords(sessionId))();
  try {
    await populateSession(sessionId, "demo.session_initialized");
    db.prepare("UPDATE demo_sessions SET seeded_at = ?, updated_at = ? WHERE session_id = ?").run(now(), now(), sessionId);
  } catch (error) {
    db.transaction(() => {
      deleteSessionRecords(sessionId);
      db.prepare("UPDATE demo_sessions SET reviewer_id = 'sam', seeded_at = NULL, updated_at = ? WHERE session_id = ?").run(now(), sessionId);
    })();
    throw error;
  }
}

export function seedReferenceData(): void {
  const db = getDb();
  const addVendor = db.prepare("INSERT INTO vendors VALUES (?,?,?,?,?,?)");
  const addPo = db.prepare("INSERT INTO purchase_orders VALUES (?,?,?,?,?)");
  const addLine = db.prepare("INSERT INTO po_lines (po_number, sku, description, quantity, unit_price) VALUES (?,?,?,?,?)");
  db.transaction(() => {
    const count = (db.prepare("SELECT COUNT(*) AS n FROM vendors").get() as { n: number }).n;
    if (count > 0) return;
    for (const vendor of VENDORS) addVendor.run(vendor[0], vendor[1], JSON.stringify(vendor[2]), vendor[3], vendor[4], vendor[5]);
    for (const [number, vendor, status, issued, lines] of POS) {
      addPo.run(number, vendor, status, "USD", issued);
      for (const line of lines) addLine.run(number, ...line);
    }
  })();
}

export function ensureDemoSession(sessionId: string): Promise<void> {
  assertSessionId(sessionId);
  return withSessionLock(sessionId, () => initializeSession(sessionId));
}

export function resetDemoSession(sessionId: string): Promise<void> {
  assertSessionId(sessionId);
  return withSessionLock(sessionId, async () => {
    seedReferenceData();
    ensureSessionRow(sessionId);
    const db = getDb();
    db.transaction(() => {
      deleteSessionRecords(sessionId);
      db.prepare("UPDATE demo_sessions SET reviewer_id = 'sam', seeded_at = NULL, updated_at = ? WHERE session_id = ?").run(now(), sessionId);
    })();
    try {
      await populateSession(sessionId, "demo.session_reset");
      db.prepare("UPDATE demo_sessions SET seeded_at = ?, updated_at = ? WHERE session_id = ?").run(now(), now(), sessionId);
    } catch (error) {
      db.transaction(() => {
        deleteSessionRecords(sessionId);
        db.prepare("UPDATE demo_sessions SET seeded_at = NULL, updated_at = ? WHERE session_id = ?").run(now(), sessionId);
      })();
      throw error;
    }
  });
}

export function resetLocalDemoData(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The global demo reset is disabled in production");
  }
  const db = getDb();
  db.transaction(() => {
    for (const table of ["audit_log", "reviews", "invoices", "demo_sessions", "po_lines", "purchase_orders", "vendors"]) {
      db.exec(`DELETE FROM ${table}`);
    }
    db.prepare("UPDATE invoice_id_sequence SET value = 0 WHERE name = 'invoice'").run();
  })();
  seedReferenceData();
}
