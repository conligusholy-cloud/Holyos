-- Krátké shrnutí, za co se platí (poznámka k platbě)
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_note" VARCHAR(60);
