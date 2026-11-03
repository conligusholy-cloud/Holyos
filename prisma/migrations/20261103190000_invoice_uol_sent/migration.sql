-- Ruční označení „odesláno do účetnictví (ÚOL)" u faktury.
-- Doklady odeslané exportem se poznají z accounting_export_items.sent;
-- tyhle sloupce drží, kdo a kdy doklad označil ručně.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "uol_sent_at" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "uol_sent_by" VARCHAR(150);
