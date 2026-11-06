-- Zprávy mezi hráči: prostý chat jeden na jednoho.
CREATE TABLE IF NOT EXISTS "game_messages" (
  "id"         SERIAL PRIMARY KEY,
  "from_id"    INTEGER NOT NULL,
  "to_id"      INTEGER NOT NULL,
  "text"       VARCHAR(800) NOT NULL,
  "read_at"    TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "game_messages_to_id_read_at_idx" ON "game_messages"("to_id", "read_at");
CREATE INDEX IF NOT EXISTS "game_messages_from_id_to_id_id_idx" ON "game_messages"("from_id", "to_id", "id");
