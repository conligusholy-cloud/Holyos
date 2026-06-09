-- Migration: add_compounder_events
-- Analytika chování pro compounder.world — anonymní eventy (sid = session id).
-- register_success nese v props lead_id → per-lead cesta. Idempotentní (Railway pattern).

CREATE TABLE IF NOT EXISTS "compounder_events" (
  "id"         SERIAL PRIMARY KEY,
  "sid"        VARCHAR(64)  NOT NULL,
  "event"      VARCHAR(60)  NOT NULL,
  "props"      JSONB,
  "path"       VARCHAR(300),
  "lang"       VARCHAR(10),
  "ua"         TEXT,
  "ip"         VARCHAR(64),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "compounder_events_sid_idx"        ON "compounder_events" ("sid");
CREATE INDEX IF NOT EXISTS "compounder_events_event_idx"      ON "compounder_events" ("event");
CREATE INDEX IF NOT EXISTS "compounder_events_created_at_idx" ON "compounder_events" ("created_at");
