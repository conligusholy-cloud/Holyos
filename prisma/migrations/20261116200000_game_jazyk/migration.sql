-- Jazyk hry u účtu. Prázdné = čeština, tedy dosavadní chování.
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "jazyk" VARCHAR(5);
