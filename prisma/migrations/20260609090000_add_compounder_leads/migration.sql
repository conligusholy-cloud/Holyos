-- Migration: add_compounder_leads
-- Iniciativa Compounder — brandový web compounder.world.
-- Tabulka compounder_leads drží registrace z veřejného webu (bez auth):
-- návštěvník zadá jméno + e-mail a zvolí roli Compounder (investor) nebo
-- Distributor. Oddělené od job_applicants i sales_contacts (jiný kontext).
--
-- Idempotentní — přežije opakované spuštění (Railway pattern,
-- memory holyos_prisma_migrate_workflow).

CREATE TABLE IF NOT EXISTS "compounder_leads" (
  "id"         SERIAL PRIMARY KEY,
  "name"       VARCHAR(255) NOT NULL,
  "email"      VARCHAR(255) NOT NULL,
  "role"       VARCHAR(20)  NOT NULL DEFAULT 'compounder',
  "lang"       VARCHAR(10),
  "status"     VARCHAR(30)  NOT NULL DEFAULT 'new',
  "source"     VARCHAR(50)  NOT NULL DEFAULT 'web',
  "ref"        VARCHAR(500),
  "ip"         VARCHAR(64),
  "user_agent" TEXT,
  "notes"      TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "compounder_leads_status_idx" ON "compounder_leads" ("status");
CREATE INDEX IF NOT EXISTS "compounder_leads_role_idx"   ON "compounder_leads" ("role");
CREATE INDEX IF NOT EXISTS "compounder_leads_email_idx"  ON "compounder_leads" ("email");
