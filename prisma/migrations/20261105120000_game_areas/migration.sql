-- Laundromats Milionář — trvalá cache prozkoumaných měst
CREATE TABLE IF NOT EXISTS "game_areas" (
  "id" SERIAL NOT NULL,
  "key" VARCHAR(80) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "lat" DOUBLE PRECISION,
  "lon" DOUBLE PRECISION,
  "population" INTEGER,
  "spots" JSONB NOT NULL,
  "hits" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "game_areas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "game_areas_key_key" ON "game_areas"("key");
