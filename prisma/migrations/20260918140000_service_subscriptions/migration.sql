-- HolyOS — Servisní předplatné (opakovaná měsíční fakturace 13 % z obratu stroje)
CREATE TABLE IF NOT EXISTS "service_subscriptions" (
  "id" SERIAL PRIMARY KEY,
  "kiosk_code" VARCHAR(40) NOT NULL,
  "contract_id" INTEGER,
  "company_id" INTEGER,
  "buyer_ico" VARCHAR(20),
  "customer_name" VARCHAR(255),
  "email" VARCHAR(255),
  "fee_pct" DECIMAL(5,2) NOT NULL DEFAULT 13,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'CZK',
  "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 21,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "auto_send" BOOLEAN NOT NULL DEFAULT false,
  "billing_day" INTEGER NOT NULL DEFAULT 3,
  "last_billed_ym" VARCHAR(7),
  "note" TEXT,
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "service_subscriptions_kiosk_code_key" ON "service_subscriptions" ("kiosk_code");
CREATE INDEX IF NOT EXISTS "service_subscriptions_active_idx" ON "service_subscriptions" ("active");
