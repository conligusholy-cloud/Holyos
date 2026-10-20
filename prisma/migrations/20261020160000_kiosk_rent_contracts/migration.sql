-- Nájemní smlouvy kiosků + vazba podkladů na smlouvu, evidence odeslání
CREATE TABLE IF NOT EXISTS "kiosk_rent_contracts" (
  "id" SERIAL PRIMARY KEY,
  "kiosk_code" VARCHAR(40) NOT NULL,
  "customer_name" VARCHAR(255),
  "buyer_ico" VARCHAR(20),
  "contact_name" VARCHAR(255),
  "contact_email" VARCHAR(255),
  "cc_emails" VARCHAR(500),
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "issue_day" INTEGER NOT NULL DEFAULT 5,
  "auto_mode" VARCHAR(10) NOT NULL DEFAULT 'draft',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'CZK',
  "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 21,
  "fee_pct" DECIMAL(5,2) NOT NULL DEFAULT 13,
  "vat_deductible" BOOLEAN NOT NULL DEFAULT true,
  "rent_rules" JSONB,
  "energy_rules" JSONB,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "kiosk_rent_contracts_kiosk_code_key" ON "kiosk_rent_contracts"("kiosk_code");
CREATE INDEX IF NOT EXISTS "kiosk_rent_contracts_active_idx" ON "kiosk_rent_contracts"("active");

ALTER TABLE "kiosk_rent_statements" ADD COLUMN IF NOT EXISTS "contract_id" INTEGER;
ALTER TABLE "kiosk_rent_statements" ADD COLUMN IF NOT EXISTS "sent_at" TIMESTAMP(3);
ALTER TABLE "kiosk_rent_statements" ADD COLUMN IF NOT EXISTS "sent_to" VARCHAR(255);
ALTER TABLE "kiosk_rent_statements" ADD COLUMN IF NOT EXISTS "send_error" TEXT;
ALTER TABLE "kiosk_rent_statements" ALTER COLUMN "subscription_id" DROP NOT NULL;
DROP INDEX IF EXISTS "kiosk_rent_statements_subscription_id_period_ym_key";
CREATE UNIQUE INDEX IF NOT EXISTS "kiosk_rent_statements_contract_id_period_ym_key" ON "kiosk_rent_statements"("contract_id", "period_ym");
