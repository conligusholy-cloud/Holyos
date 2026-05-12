-- HolyOS — Obchodní pomůcky: per-field locks pro výchozí hodnoty pomůcky
-- Objekt { field_key: true } — pole, která admin uzamkl a zákazník je nesmí měnit.

ALTER TABLE "business_tool_defaults"
  ADD COLUMN IF NOT EXISTS "locks_json" JSONB NOT NULL DEFAULT '{}'::jsonb;
