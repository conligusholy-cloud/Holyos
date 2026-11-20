-- Kolik který držený podíl fondu nesl měsíčně. Hodnota fondu se vzorkuje už
-- dřív, ale jen jako celek — u jednotlivého podílu nebylo s čím srovnat, a
-- tak u něj nešlo říct, jestli roste, nebo padá. Vzorkuje se spolu s hodnotou
-- fondu: jednou za hodinu a po každé události, která fondem pohne.
CREATE TABLE IF NOT EXISTS "game_fond_drzba" (
  "id"         SERIAL PRIMARY KEY,
  "aliance_id" INTEGER NOT NULL,
  "firma_id"   INTEGER NOT NULL,
  -- Kolik ten podíl fondu nese za herní měsíc, v L$.
  "mesicne"    INTEGER NOT NULL DEFAULT 0,
  "kdy"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Čte se vždycky poslední vzorek jednoho fondu — podle toho je i index.
CREATE INDEX IF NOT EXISTS "game_fond_drzba_posledni"
  ON "game_fond_drzba"("aliance_id", "firma_id", "kdy" DESC);
CREATE INDEX IF NOT EXISTS "game_fond_drzba_kdy" ON "game_fond_drzba"("kdy");
