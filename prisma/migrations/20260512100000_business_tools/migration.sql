-- HolyOS — Obchodní pomůcky
-- Sdílení sales-aid nástrojů (např. Ekonomika prádlomatu) se zákazníky přes
-- tokenovaný odkaz. K tomu seznam přijemců, uložené verze modelů a event log
-- pro tracking využití (opened / edited / saved / exported).

-- =============================================================================
-- business_tool_recipients
-- =============================================================================

CREATE TABLE IF NOT EXISTS "business_tool_recipients" (
  "id"           SERIAL PRIMARY KEY,
  "tool"         VARCHAR(60)  NOT NULL,
  "name"         VARCHAR(255) NOT NULL,
  "email"        VARCHAR(255) NOT NULL,
  "company"      VARCHAR(255),
  "note"         TEXT,
  "share_token"  VARCHAR(80)  NOT NULL,
  "created_by"   INTEGER      NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_opened"  TIMESTAMP(3),
  "open_count"   INTEGER      NOT NULL DEFAULT 0,
  "save_count"   INTEGER      NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS "business_tool_recipients_share_token_key"
  ON "business_tool_recipients" ("share_token");

CREATE INDEX IF NOT EXISTS "business_tool_recipients_created_by_idx"
  ON "business_tool_recipients" ("created_by");

CREATE INDEX IF NOT EXISTS "business_tool_recipients_tool_idx"
  ON "business_tool_recipients" ("tool");

CREATE INDEX IF NOT EXISTS "business_tool_recipients_share_token_idx"
  ON "business_tool_recipients" ("share_token");

ALTER TABLE "business_tool_recipients"
  ADD CONSTRAINT "business_tool_recipients_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- =============================================================================
-- business_tool_models
-- =============================================================================

CREATE TABLE IF NOT EXISTS "business_tool_models" (
  "id"            SERIAL PRIMARY KEY,
  "recipient_id"  INTEGER      NOT NULL,
  "name"          VARCHAR(255) NOT NULL DEFAULT 'Pracovní model',
  "data_json"     JSONB        NOT NULL,
  "computed_json" JSONB,
  "saved_from"    VARCHAR(20)  NOT NULL DEFAULT 'customer',
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "business_tool_models_recipient_id_idx"
  ON "business_tool_models" ("recipient_id");

ALTER TABLE "business_tool_models"
  ADD CONSTRAINT "business_tool_models_recipient_id_fkey"
  FOREIGN KEY ("recipient_id") REFERENCES "business_tool_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- business_tool_events
-- =============================================================================

CREATE TABLE IF NOT EXISTS "business_tool_events" (
  "id"           SERIAL PRIMARY KEY,
  "recipient_id" INTEGER      NOT NULL,
  "event_type"   VARCHAR(30)  NOT NULL,
  "payload"      JSONB,
  "ip"           VARCHAR(45),
  "user_agent"   TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "business_tool_events_recipient_id_idx"
  ON "business_tool_events" ("recipient_id");

CREATE INDEX IF NOT EXISTS "business_tool_events_event_type_idx"
  ON "business_tool_events" ("event_type");

CREATE INDEX IF NOT EXISTS "business_tool_events_created_at_idx"
  ON "business_tool_events" ("created_at");

ALTER TABLE "business_tool_events"
  ADD CONSTRAINT "business_tool_events_recipient_id_fkey"
  FOREIGN KEY ("recipient_id") REFERENCES "business_tool_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
