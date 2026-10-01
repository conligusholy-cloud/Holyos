-- Výrobek: příznak aktivní
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
