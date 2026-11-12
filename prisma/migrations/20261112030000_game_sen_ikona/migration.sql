-- Místo kreslení obrázku modelem vybíráme z pevné sady ikon. Kreslené pokusy
-- byly k nepoznání a vlastní fotka stejně vypadá líp.
ALTER TABLE "game_dreams" ADD COLUMN IF NOT EXISTS "ikona" VARCHAR(24);
