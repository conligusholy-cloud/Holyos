-- Prodaná zem pod vlastním prádlomatem (Požadavek #158)
-- Zábor zůstává provozovateli, u něj se jen eviduje majitel země pod ním.
-- Pozor: název tabulky je z @@map, ne název modelu.
ALTER TABLE "game_spot_claims"
  ADD COLUMN IF NOT EXISTS "pozemek_majitel_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "pozemek_majitel_nick" VARCHAR(24);

CREATE INDEX IF NOT EXISTS "game_spot_claims_pozemek_majitel_id_idx"
  ON "game_spot_claims"("pozemek_majitel_id");
