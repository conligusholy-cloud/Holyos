-- Nájemní podmínky míst: doba určitá a výpovědní doba.
-- Vázanost drží majitele pozemku (dokud běží, nájemce nejde vypovědět),
-- výpovědní doba dává přeplacenému nájemci čas místo si udržet dorovnáním.
ALTER TABLE "game_spot_claims" ADD COLUMN "vazano_do" TIMESTAMP(3);
ALTER TABLE "game_spot_claims" ADD COLUMN "vypoved_mesicu" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "game_spot_claims" ADD COLUMN "vypoved_do" TIMESTAMP(3);
ALTER TABLE "game_spot_claims" ADD COLUMN "vyzyvatel_id" INTEGER;
ALTER TABLE "game_spot_claims" ADD COLUMN "vyzyvatel_nick" VARCHAR(24);
ALTER TABLE "game_spot_claims" ADD COLUMN "vyzyvatel_rent" INTEGER;
ALTER TABLE "game_spot_claims" ADD COLUMN "vyzyvatel_model" VARCHAR(10);
CREATE INDEX "game_spot_claims_vypoved_do_idx" ON "game_spot_claims"("vypoved_do");
