-- =============================================================================
-- Daňový doklad k přijaté platbě (DPPP) + bezpečné číselné řady
-- =============================================================================

-- Invoice: vazby na zdroj (zálohová faktura, platba, bankovní transakce) + evidence odeslání
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "parent_invoice_id" INTEGER;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "source_payment_id" INTEGER;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "source_bank_transaction_id" INTEGER;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "delivery_status" VARCHAR(20) NOT NULL DEFAULT 'not_sent';
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "sent_at" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "sent_to" VARCHAR(255);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "send_error" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "send_message_id" VARCHAR(255);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "send_attempts" INTEGER NOT NULL DEFAULT 0;

-- Index na parent + idempotentní unikát (platba, zálohová faktura)
CREATE INDEX IF NOT EXISTS "invoices_parent_invoice_id_idx" ON "invoices"("parent_invoice_id");
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_source_payment_id_parent_invoice_id_key" ON "invoices"("source_payment_id", "parent_invoice_id");

-- FK parent_invoice_id → invoices(id) (self-relation), jen pokud ještě neexistuje
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'invoices_parent_invoice_id_fkey' AND table_name = 'invoices'
  ) THEN
    ALTER TABLE "invoices"
      ADD CONSTRAINT "invoices_parent_invoice_id_fkey"
      FOREIGN KEY ("parent_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

-- Atomický čítač číselných řad dokladů
CREATE TABLE IF NOT EXISTS "document_counters" (
  "id"         SERIAL PRIMARY KEY,
  "series"     VARCHAR(30) NOT NULL,
  "last_seq"   INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "document_counters_series_key" ON "document_counters"("series");
