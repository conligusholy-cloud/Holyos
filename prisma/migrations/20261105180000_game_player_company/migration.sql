-- Laundromats Milionář — název firmy hráče
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "company" VARCHAR(60);
-- Kdo už hraje, dostane firmu odvozenou z nicku, ať nikde nezeje prázdno.
UPDATE "game_players" SET "company" = "nick" || ' s.r.o.' WHERE "company" IS NULL;
