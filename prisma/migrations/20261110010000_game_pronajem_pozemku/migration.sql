-- Pronájem vlastního pozemku jinému hráči. Majitel vypíše nájem a jestli je
-- plocha připravená; nájemce na ní staví a platí majiteli měsíční nájem.
ALTER TABLE "game_spot_claims" ADD COLUMN IF NOT EXISTS "pronajem_cena" INTEGER;
ALTER TABLE "game_spot_claims" ADD COLUMN IF NOT EXISTS "pronajem_sit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "game_spot_claims" ADD COLUMN IF NOT EXISTS "najemce_id" INTEGER;
ALTER TABLE "game_spot_claims" ADD COLUMN IF NOT EXISTS "najemce_nick" VARCHAR(24);
ALTER TABLE "game_spot_claims" ADD COLUMN IF NOT EXISTS "najem_od" TIMESTAMP(3);
ALTER TABLE "game_spot_claims" ADD COLUMN IF NOT EXISTS "najem_do" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "game_spot_claims_najemce_id_idx" ON "game_spot_claims"("najemce_id");
