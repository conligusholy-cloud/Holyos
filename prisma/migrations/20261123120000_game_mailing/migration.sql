-- Laundromat Tycoon — e-mailing: seznam kontaktů, kampaně a evidence odeslání.
CREATE TABLE IF NOT EXISTS "game_mail_contacts" (
  "id" SERIAL NOT NULL,
  "email" VARCHAR(200) NOT NULL,
  "email_lower" VARCHAR(200) NOT NULL,
  "first_name" VARCHAR(100),
  "last_name" VARCHAR(100),
  "company" VARCHAR(200),
  "phone" VARCHAR(60),
  "lang" VARCHAR(5),
  "tags" VARCHAR(300),
  "extra" JSONB,
  "status" VARCHAR(16) NOT NULL DEFAULT 'active',
  "source" VARCHAR(80),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "game_mail_contacts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "game_mail_contacts_email_lower_key" ON "game_mail_contacts"("email_lower");
CREATE INDEX IF NOT EXISTS "game_mail_contacts_status_idx" ON "game_mail_contacts"("status");

CREATE TABLE IF NOT EXISTS "game_mail_campaigns" (
  "id" SERIAL NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "kind" VARCHAR(12) NOT NULL,
  "subject" VARCHAR(300) NOT NULL,
  "body" TEXT NOT NULL DEFAULT '',
  "link" VARCHAR(500),
  "link_label" VARCHAR(80),
  "steps" JSONB,
  "from_address" VARCHAR(200),
  "from_name" VARCHAR(100),
  "reply_to" VARCHAR(200),
  "lang" VARCHAR(5),
  "audience" JSONB,
  "schedule" JSONB,
  "status" VARCHAR(12) NOT NULL DEFAULT 'draft',
  "next_run_at" TIMESTAMP(3),
  "last_run_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "sent_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_by" VARCHAR(120),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "game_mail_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "game_mail_campaigns_status_next_run_at_idx" ON "game_mail_campaigns"("status", "next_run_at");

CREATE TABLE IF NOT EXISTS "game_mail_sends" (
  "id" SERIAL NOT NULL,
  "campaign_id" INTEGER NOT NULL,
  "email_lower" VARCHAR(200) NOT NULL,
  "run_key" VARCHAR(40) NOT NULL,
  "status" VARCHAR(12) NOT NULL,
  "error" VARCHAR(300),
  "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "game_mail_sends_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "game_mail_sends_campaign_id_email_lower_run_key_key" ON "game_mail_sends"("campaign_id", "email_lower", "run_key");
CREATE INDEX IF NOT EXISTS "game_mail_sends_campaign_id_idx" ON "game_mail_sends"("campaign_id");
