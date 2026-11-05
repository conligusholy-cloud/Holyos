-- Kdo koho přivedl do hry. Sdílené id hráče (ref_id) a odkaz na toho, kdo ho pozval.
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "ref_id"         VARCHAR(24);
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "invited_by_id"  INTEGER;
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "invited_by_ref" VARCHAR(24);
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "invited_at"     TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "game_players_ref_id_key"         ON "game_players" ("ref_id");
CREATE INDEX        IF NOT EXISTS "game_players_invited_by_id_idx"  ON "game_players" ("invited_by_id");
CREATE INDEX        IF NOT EXISTS "game_players_invited_by_ref_idx" ON "game_players" ("invited_by_ref");

DO $$ BEGIN
  ALTER TABLE "game_players"
    ADD CONSTRAINT "game_players_invited_by_id_fkey"
    FOREIGN KEY ("invited_by_id") REFERENCES "game_players"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
