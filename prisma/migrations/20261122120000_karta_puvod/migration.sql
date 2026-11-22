-- Uvítací karta se nepřevádí.
--
-- Každý nový účet dostane jednu kartu od každého druhu zdarma — včetně karty
-- na návštěvnost, která natrvalo násobí tržbu celé sítě. Dokud se dala
-- převést, stačilo založit účet, vybrat ji a poslat hlavnímu: z 224 karet na
-- návštěvnost ve hře jich 165 přišlo z uvítacích balíčků a 39 už změnilo
-- majitele. Jeden hráč jich takhle nasbíral třicet.
ALTER TABLE "game_cards" ADD COLUMN IF NOT EXISTS "puvod" VARCHAR(16);

-- Dohledání zpětně: uvítací karta vznikla ve stejnou chvíli jako účet a nikdo
-- ji nekoupil. Karty, které už někam odešly, se takhle nepoznají — ty řeší
-- řízení o zločinu, ne tahle migrace.
UPDATE "game_cards" c
   SET "puvod" = 'uvitaci'
  FROM "game_players" p
 WHERE c."player_id" = p."id"
   AND c."purchase_id" IS NULL
   AND c."puvod" IS NULL
   AND ABS(EXTRACT(EPOCH FROM (c."created_at" - p."created_at"))) < 120;
