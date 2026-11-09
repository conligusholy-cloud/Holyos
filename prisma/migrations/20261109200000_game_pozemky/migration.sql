-- Místa na vlastním pozemku. Kdo zem koupil, neplatí nájem a nejde ho přeplatit.
ALTER TABLE "game_spot_claims" ADD COLUMN "pozemek" BOOLEAN NOT NULL DEFAULT false;
