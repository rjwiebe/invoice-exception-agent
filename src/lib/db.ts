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
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, raw_text TEXT NOT NULL, status TEXT NOT NULL,
  vendor_id TEXT, extracted_json TEXT, checks_json TEXT NOT NULL DEFAULT '[]',
  explanation_json TEXT, explanation_by TEXT, extracted_by TEXT,
  resolved_by TEXT, resolved_reason TEXT, resolved_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id TEXT NOT NULL REFERENCES invoices(id),
  action TEXT NOT NULL, reason TEXT NOT NULL, reviewer TEXT NOT NULL, role TEXT NOT NULL,
  corrections_json TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id TEXT, ts TEXT NOT NULL,
  actor_type TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, summary TEXT NOT NULL,
  details TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_invoice ON audit_log(invoice_id);
`;

const g = globalThis as unknown as { __db?: Database.Database };

export function getDb(): Database.Database {
  if (!g.__db) {
    const file = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "app.db");
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new Database(file);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA);
    g.__db = db;
  }
  return g.__db;
}
