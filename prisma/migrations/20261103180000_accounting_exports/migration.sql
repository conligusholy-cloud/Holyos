-- Export dokladů pro účetní (periodické odesílání příloh v ZIPu)
CREATE TABLE IF NOT EXISTS "accounting_exports" (
  "id" SERIAL PRIMARY KEY,
  "period_from" TIMESTAMP(3) NOT NULL,
  "period_to" TIMESTAMP(3) NOT NULL,
  "trigger" VARCHAR(20) NOT NULL DEFAULT 'manual',
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "recipients" VARCHAR(1000) NOT NULL,
  "sender" VARCHAR(255),
  "doc_count" INTEGER NOT NULL DEFAULT 0,
  "missing_count" INTEGER NOT NULL DEFAULT 0,
  "part_count" INTEGER NOT NULL DEFAULT 0,
  "total_bytes" INTEGER NOT NULL DEFAULT 0,
  "parts" JSONB,
  "error" TEXT,
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "accounting_exports_period_from_idx" ON "accounting_exports"("period_from");
CREATE INDEX IF NOT EXISTS "accounting_exports_status_idx" ON "accounting_exports"("status");

CREATE TABLE IF NOT EXISTS "accounting_export_items" (
  "id" SERIAL PRIMARY KEY,
  "export_id" INTEGER NOT NULL REFERENCES "accounting_exports"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "invoice_id" INTEGER NOT NULL,
  "invoice_number" VARCHAR(50) NOT NULL,
  "external_number" VARCHAR(100),
  "direction" VARCHAR(2) NOT NULL,
  "type" VARCHAR(30),
  "company_name" VARCHAR(255),
  "date_issued" DATE,
  "total" DECIMAL(14,2),
  "currency" VARCHAR(3),
  "part" INTEGER NOT NULL DEFAULT 0,
  "file_name" VARCHAR(255),
  "file_bytes" INTEGER NOT NULL DEFAULT 0,
  "missing" BOOLEAN NOT NULL DEFAULT false,
  "sent" BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS "accounting_export_items_export_id_idx" ON "accounting_export_items"("export_id");
CREATE INDEX IF NOT EXISTS "accounting_export_items_invoice_id_idx" ON "accounting_export_items"("invoice_id");
