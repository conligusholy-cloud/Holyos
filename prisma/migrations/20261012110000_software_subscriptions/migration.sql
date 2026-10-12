-- Jazyk dokladu + softwarová podpora (měsíční fakturace)
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "language" VARCHAR(5) NOT NULL DEFAULT 'cs';

CREATE TABLE IF NOT EXISTS "software_subscriptions" (
  "id" SERIAL PRIMARY KEY,
  "kiosk_code" VARCHAR(40) NOT NULL,
  "contract_number" VARCHAR(80),
  "company_id" INTEGER,
  "buyer_ico" VARCHAR(20),
  "buyer_dic" VARCHAR(30),
  "customer_name" VARCHAR(255),
  "email" VARCHAR(255),
  "amount" DECIMAL(12,2) NOT NULL DEFAULT 60,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
  "vat_regime" VARCHAR(20) NOT NULL DEFAULT 'standard',
  "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 21,
  "language" VARCHAR(5) NOT NULL DEFAULT 'cs',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "auto_send" BOOLEAN NOT NULL DEFAULT false,
  "billing_day" INTEGER NOT NULL DEFAULT 1,
  "last_billed_ym" VARCHAR(7),
  "note" TEXT,
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "software_subscriptions_kiosk_code_key" ON "software_subscriptions"("kiosk_code");
CREATE INDEX IF NOT EXISTS "software_subscriptions_active_idx" ON "software_subscriptions"("active");
