-- Pozvánky napevno do databáze (dřív jen v paměti serveru).
CREATE TABLE IF NOT EXISTS "game_refs" (
  "id"         SERIAL       PRIMARY KEY,
  "ref_id"     VARCHAR(24)  NOT NULL,
  "visitor"    VARCHAR(64)  NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "game_refs_ref_id_visitor_key" ON "game_refs" ("ref_id", "visitor");
CREATE INDEX IF NOT EXISTS "game_refs_ref_id_idx" ON "game_refs" ("ref_id");
