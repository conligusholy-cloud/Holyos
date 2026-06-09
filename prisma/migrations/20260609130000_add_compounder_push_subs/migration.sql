-- Migration: add_compounder_push_subs
-- Web Push (VAPID) odběry pro compounder.world. lead_id spojuje s leadem.
-- Idempotentní (Railway pattern).

CREATE TABLE IF NOT EXISTS "compounder_push_subs" (
  "id"           SERIAL PRIMARY KEY,
  "endpoint"     VARCHAR(500) NOT NULL,
  "p256dh"       VARCHAR(255) NOT NULL,
  "auth"         VARCHAR(255) NOT NULL,
  "lead_id"      INTEGER,
  "sid"          VARCHAR(64),
  "lang"         VARCHAR(10),
  "ua"           TEXT,
  "last_sent_at" TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "compounder_push_subs_endpoint_key" ON "compounder_push_subs" ("endpoint");
CREATE INDEX IF NOT EXISTS "compounder_push_subs_lead_id_idx" ON "compounder_push_subs" ("lead_id");
