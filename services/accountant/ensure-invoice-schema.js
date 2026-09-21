// =============================================================================
// HolyOS — Boot-time pojistka schématu fakturace (DPPP + čítače řad)
// =============================================================================
//
// Idempotentně zajistí sloupce/tabulku, na kterých závisí generování čísel
// dokladů a daňové doklady k přijaté platbě. Slouží jako záchrana, když se
// migrace 20260921140000_deposit_tax_doc_and_counters nestihla spustit proti DB
// (např. nedostupný veřejný proxy) — aplikace si potřebné objekty vytvoří sama
// přes interní připojení při startu. Vše je `IF NOT EXISTS`, takže opakované
// spuštění je bezpečné.

'use strict';

const { prisma } = require('../../config/database');

const STATEMENTS = [
  `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "parent_invoice_id" INTEGER`,
  `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "source_payment_id" INTEGER`,
  `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "source_bank_transaction_id" INTEGER`,
  `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "delivery_status" VARCHAR(20) NOT NULL DEFAULT 'not_sent'`,
  `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "sent_at" TIMESTAMP(3)`,
  `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "sent_to" VARCHAR(255)`,
  `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "send_error" TEXT`,
  `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "send_message_id" VARCHAR(255)`,
  `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "send_attempts" INTEGER NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS "invoices_parent_invoice_id_idx" ON "invoices"("parent_invoice_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "invoices_source_payment_id_parent_invoice_id_key" ON "invoices"("source_payment_id", "parent_invoice_id")`,
  `CREATE TABLE IF NOT EXISTS "document_counters" (
     "id" SERIAL PRIMARY KEY,
     "series" VARCHAR(30) NOT NULL,
     "last_seq" INTEGER NOT NULL DEFAULT 0,
     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "document_counters_series_key" ON "document_counters"("series")`,
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
       WHERE constraint_name = 'invoices_parent_invoice_id_fkey' AND table_name = 'invoices'
     ) THEN
       ALTER TABLE "invoices"
         ADD CONSTRAINT "invoices_parent_invoice_id_fkey"
         FOREIGN KEY ("parent_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
     END IF;
   END$$`,
];

let _done = false;

/** Idempotentně dožene schéma fakturace. Best-effort, nikdy nevyhazuje. */
async function ensureInvoiceSchema() {
  if (_done) return;
  for (const sql of STATEMENTS) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (e) {
      console.warn('[ensureInvoiceSchema] statement selhal (pokračuji):', e.message);
    }
  }
  _done = true;
  console.log('[ensureInvoiceSchema] schéma fakturace ověřeno.');
}

module.exports = { ensureInvoiceSchema };
