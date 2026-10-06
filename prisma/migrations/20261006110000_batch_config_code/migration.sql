-- Výrobní kód dávky (kód výrobku + kódy zvolených provedení)
ALTER TABLE "production_batches" ADD COLUMN IF NOT EXISTS "config_code" VARCHAR(160);
