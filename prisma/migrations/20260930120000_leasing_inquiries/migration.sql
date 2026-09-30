-- Poptávky financování odeslané leasingovým společnostem
CREATE TABLE IF NOT EXISTS "leasing_inquiries" (
  "id" SERIAL NOT NULL,
  "leasing_company_id" INTEGER NOT NULL,
  "compounder_lead_id" INTEGER,
  "sent_by_person_id" INTEGER,
  "token" VARCHAR(64) NOT NULL,
  "client_first_name" VARCHAR(120) NOT NULL,
  "client_last_name" VARCHAR(120) NOT NULL,
  "client_company" VARCHAR(255),
  "client_ico" VARCHAR(20),
  "client_email" VARCHAR(255),
  "client_phone" VARCHAR(60),
  "subject" VARCHAR(300) NOT NULL,
  "price" DECIMAL(12,2) NOT NULL,
  "akontace_pct" DECIMAL(5,2),
  "months" INTEGER,
  "note" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'sent',
  "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deadline_at" TIMESTAMP(3),
  "email_sent" BOOLEAN NOT NULL DEFAULT false,
  "sms_sent" BOOLEAN NOT NULL DEFAULT false,
  "sms_id" VARCHAR(80),
  "opened_at" TIMESTAMP(3),
  "responded_at" TIMESTAMP(3),
  "result_note" TEXT,
  "result_monthly" DECIMAL(12,2),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leasing_inquiries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "leasing_inquiries_token_key" ON "leasing_inquiries"("token");
CREATE INDEX IF NOT EXISTS "leasing_inquiries_leasing_company_id_idx" ON "leasing_inquiries"("leasing_company_id");
CREATE INDEX IF NOT EXISTS "leasing_inquiries_compounder_lead_id_idx" ON "leasing_inquiries"("compounder_lead_id");
CREATE INDEX IF NOT EXISTS "leasing_inquiries_status_idx" ON "leasing_inquiries"("status");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leasing_inquiries_leasing_company_id_fkey') THEN
    ALTER TABLE "leasing_inquiries" ADD CONSTRAINT "leasing_inquiries_leasing_company_id_fkey" FOREIGN KEY ("leasing_company_id") REFERENCES "leasing_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
