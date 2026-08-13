-- Jen provoz (bez ceny a návratnosti) — nezávisle na variantě V2/V3/BOTH.
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "eco_no_price" BOOLEAN NOT NULL DEFAULT false;
