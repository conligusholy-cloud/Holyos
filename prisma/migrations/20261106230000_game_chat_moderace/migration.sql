-- Moderace chatu: nahlášení zprávy a blokování hráče.
ALTER TABLE "game_messages" ADD COLUMN IF NOT EXISTS "reported_at" TIMESTAMP(3);
ALTER TABLE "game_messages" ADD COLUMN IF NOT EXISTS "reported_by" INTEGER;
ALTER TABLE "game_messages" ADD COLUMN IF NOT EXISTS "resolved_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "game_messages_reported_at_idx" ON "game_messages"("reported_at");

CREATE TABLE IF NOT EXISTS "game_blocks" (
  "id"         SERIAL PRIMARY KEY,
  "blocker_id" INTEGER NOT NULL,
  "blocked_id" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "game_blocks_blocker_id_blocked_id_key" ON "game_blocks"("blocker_id", "blocked_id");
CREATE INDEX IF NOT EXISTS "game_blocks_blocked_id_idx" ON "game_blocks"("blocked_id");
