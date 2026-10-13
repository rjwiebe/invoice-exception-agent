import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, aliases TEXT NOT NULL,
  status TEXT NOT NULL, bank_last4 TEXT NOT NULL, payment_terms TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  number TEXT PRIMARY KEY, vendor_id TEXT NOT NULL REFERENCES vendors(id),
  status TEXT NOT NULL, currency TEXT NOT NULL, issued_on TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS po_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT, po_number TEXT NOT NULL REFERENCES purchase_orders(number),
  sku TEXT NOT NULL, description TEXT NOT NULL, quantity REAL NOT NULL, unit_price REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS demo_sessions (
  session_id TEXT PRIMARY KEY, reviewer_id TEXT NOT NULL DEFAULT 'sam',
  seeded_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES demo_sessions(session_id),
  source TEXT NOT NULL, raw_text TEXT NOT NULL, status TEXT NOT NULL,
  vendor_id TEXT, extracted_json TEXT, checks_json TEXT NOT NULL DEFAULT '[]',
  explanation_json TEXT, explanation_by TEXT, extracted_by TEXT,
  resolved_by TEXT, resolved_reason TEXT, resolved_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES demo_sessions(session_id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  action TEXT NOT NULL, reason TEXT NOT NULL, reviewer TEXT NOT NULL, role TEXT NOT NULL,
  corrections_json TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES demo_sessions(session_id),
  invoice_id TEXT, ts TEXT NOT NULL,
  actor_type TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, summary TEXT NOT NULL,
  details TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoice_id_sequence (
  name TEXT PRIMARY KEY, value INTEGER NOT NULL
);
INSERT OR IGNORE INTO invoice_id_sequence (name, value) VALUES ('invoice', 0);
`;

const g = globalThis as unknown as { __db?: Database.Database };

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).some((c) => c.name === column);
}

function migrateSessionColumns(db: Database.Database): void {
  const tables = ["invoices", "reviews", "audit_log"] as const;
  const needsLegacySession = tables.some((table) => !hasColumn(db, table, "session_id"));
  if (needsLegacySession) {
    const ts = new Date().toISOString();
    db.prepare(
      "INSERT OR IGNORE INTO demo_sessions (session_id, reviewer_id, seeded_at, created_at, updated_at) VALUES ('legacy', 'sam', ?, ?, ?)",
    ).run(ts, ts, ts);
  }
  if (!hasColumn(db, "invoices", "session_id")) {
    db.exec("ALTER TABLE invoices ADD COLUMN session_id TEXT NOT NULL DEFAULT 'legacy'");
  }
  if (!hasColumn(db, "reviews", "session_id")) {
    db.exec("ALTER TABLE reviews ADD COLUMN session_id TEXT NOT NULL DEFAULT 'legacy'");
  }
  if (!hasColumn(db, "audit_log", "session_id")) {
    db.exec("ALTER TABLE audit_log ADD COLUMN session_id TEXT NOT NULL DEFAULT 'legacy'");
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_invoices_session_created ON invoices(session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reviews_session ON reviews(session_id, invoice_id);
    CREATE INDEX IF NOT EXISTS idx_audit_session_seq ON audit_log(session_id, seq);
    CREATE INDEX IF NOT EXISTS idx_audit_session_invoice ON audit_log(session_id, invoice_id, seq);
  `);
  const maxExisting = db.prepare(
    "SELECT COALESCE(MAX(CAST(SUBSTR(id, 5) AS INTEGER)), 0) AS max FROM invoices WHERE id GLOB 'INV-[0-9]*'",
  ).get() as { max: number };
  db.prepare("UPDATE invoice_id_sequence SET value = MAX(value, ?) WHERE name = 'invoice'").run(maxExisting.max);
}

export function getDb(): Database.Database {
  if (!g.__db) {
    const file = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "app.db");
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new Database(file);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA);
    migrateSessionColumns(db);
    g.__db = db;
  }
  return g.__db;
}
