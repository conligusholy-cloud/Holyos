-- Migration: add_final_invoice_tracking
-- Doplatková faktura (vystavovaná workerem N dní před zahájením výroby) — vazba
-- z Order → Invoice + invoice_role na Invoice (deposit/final/full).

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "final_invoice_id"        INTEGER,
  ADD COLUMN IF NOT EXISTS "final_invoice_lead_days" INTEGER NOT NULL DEFAULT 14;

-- Unique constraint (nullable unique) — jedna objednávka = max jedna doplatková faktura
CREATE UNIQUE INDEX IF NOT EXISTS "orders_final_invoice_id_key" ON "orders" ("final_invoice_id");
CREATE INDEX IF NOT EXISTS "orders_final_invoice_id_idx" ON "orders" ("final_invoice_id");

-- FK Order.final_invoice_id → Invoice.id
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_final_invoice_id_fkey"
  FOREIGN KEY ("final_invoice_id") REFERENCES "invoices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Invoice.invoice_role: 'deposit' | 'final' | 'full' | NULL
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "invoice_role" VARCHAR(20);

CREATE INDEX IF NOT EXISTS "invoices_invoice_role_idx" ON "invoices" ("invoice_role");
