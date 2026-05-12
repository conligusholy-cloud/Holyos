-- HolyOS — Obchodní pomůcky: globální výchozí hodnoty pomůcek
-- Singleton per tool (unique tool slug). Adminem nastavený startovací stav,
-- který se použije pro každého nového příjemce + pro otevření v admin pohledu.

CREATE TABLE IF NOT EXISTS "business_tool_defaults" (
  "id"         SERIAL PRIMARY KEY,
  "tool"       VARCHAR(60)  NOT NULL,
  "data_json"  JSONB        NOT NULL,
  "updated_by" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "business_tool_defaults_tool_key"
  ON "business_tool_defaults" ("tool");

ALTER TABLE "business_tool_defaults"
  ADD CONSTRAINT "business_tool_defaults_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
