-- Řízení zločinu ve hře: případ (kontrola → soud → odvolání), hlasy poroty a „noviny".
CREATE TABLE IF NOT EXISTS "game_zlociny" (
  "id" SERIAL PRIMARY KEY,
  "hlavni_id" INTEGER NOT NULL,
  "hlavni_nick" VARCHAR(24) NOT NULL,
  "firma" VARCHAR(80),
  "typ" VARCHAR(10) NOT NULL,
  "utvar" VARCHAR(20) NOT NULL,
  "emblem" VARCHAR(8),
  "stav" VARCHAR(12) NOT NULL DEFAULT 'kontrola',
  "skoda" INTEGER NOT NULL DEFAULT 0,
  "zmrazeno" INTEGER NOT NULL DEFAULT 0,
  "trest_uroven" VARCHAR(8),
  "trest_castka" INTEGER,
  "zahajeno_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "kontrola_do" TIMESTAMP(3) NOT NULL,
  "soud_do" TIMESTAMP(3),
  "odvolani_do" TIMESTAMP(3),
  "uzavreno_at" TIMESTAMP(3),
  "odvolani_text" VARCHAR(1000),
  "odvolani_at" TIMESTAMP(3),
  "admin_rozhodnuti" VARCHAR(12),
  "admin_poznamka" VARCHAR(500),
  "nedoplatek" INTEGER NOT NULL DEFAULT 0,
  "detail" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "game_zlociny_hlavni_id_idx" ON "game_zlociny"("hlavni_id");
CREATE INDEX IF NOT EXISTS "game_zlociny_stav_idx" ON "game_zlociny"("stav");

CREATE TABLE IF NOT EXISTS "game_zlocin_hlasy" (
  "id" SERIAL PRIMARY KEY,
  "zlocin_id" INTEGER NOT NULL,
  "player_id" INTEGER NOT NULL,
  "volba" VARCHAR(8) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "game_zlocin_hlasy_zlocin_id_player_id_key" ON "game_zlocin_hlasy"("zlocin_id", "player_id");
CREATE INDEX IF NOT EXISTS "game_zlocin_hlasy_zlocin_id_idx" ON "game_zlocin_hlasy"("zlocin_id");

CREATE TABLE IF NOT EXISTS "game_zlocin_zpravy" (
  "id" SERIAL PRIMARY KEY,
  "zlocin_id" INTEGER,
  "nadpis" VARCHAR(160) NOT NULL,
  "text" VARCHAR(600) NOT NULL,
  "emblem" VARCHAR(8),
  "stav" VARCHAR(12),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "game_zlocin_zpravy_created_at_idx" ON "game_zlocin_zpravy"("created_at");
CREATE INDEX IF NOT EXISTS "game_zlocin_zpravy_zlocin_id_idx" ON "game_zlocin_zpravy"("zlocin_id");
