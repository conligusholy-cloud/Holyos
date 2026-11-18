-- Přístupy hráčů hry (registrace, přihlášení, aktivita, obchody) se zařízením a otiskem — pro odhalení multi účtů
CREATE TABLE IF NOT EXISTS "game_access" (
  "id" SERIAL PRIMARY KEY,
  "player_id" INTEGER NOT NULL,
  "druh" VARCHAR(12) NOT NULL,
  "ref_id" INTEGER,
  "ip" VARCHAR(64),
  "dev" VARCHAR(40),
  "fp" VARCHAR(40),
  "hw" VARCHAR(40),
  "ua" VARCHAR(300),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "game_access_player_id_created_at_idx" ON "game_access"("player_id", "created_at");
CREATE INDEX IF NOT EXISTS "game_access_dev_idx" ON "game_access"("dev");
CREATE INDEX IF NOT EXISTS "game_access_fp_idx" ON "game_access"("fp");
CREATE INDEX IF NOT EXISTS "game_access_hw_idx" ON "game_access"("hw");
CREATE INDEX IF NOT EXISTS "game_access_ref_id_idx" ON "game_access"("ref_id");
