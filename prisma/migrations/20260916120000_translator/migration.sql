-- HolyOS — Překladač (mobilní chatovací překladač)
-- Tabulky: translator_sessions + translator_lines

CREATE TABLE IF NOT EXISTS "translator_sessions" (
  "id" SERIAL PRIMARY KEY,
  "title" VARCHAR(200),
  "target_lang" VARCHAR(8) NOT NULL,
  "source_lang" VARCHAR(8),
  "created_by_user_id" INTEGER,
  "created_by_name" VARCHAR(160),
  "lines_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "translator_sessions_created_at_idx" ON "translator_sessions" ("created_at");
CREATE INDEX IF NOT EXISTS "translator_sessions_created_by_user_id_idx" ON "translator_sessions" ("created_by_user_id");

CREATE TABLE IF NOT EXISTS "translator_lines" (
  "id" SERIAL PRIMARY KEY,
  "session_id" INTEGER NOT NULL,
  "speaker" VARCHAR(40) NOT NULL DEFAULT '1',
  "original" TEXT NOT NULL,
  "translated" TEXT,
  "source_lang" VARCHAR(8),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "translator_lines_session_id_fkey" FOREIGN KEY ("session_id")
    REFERENCES "translator_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "translator_lines_session_id_idx" ON "translator_lines" ("session_id");
