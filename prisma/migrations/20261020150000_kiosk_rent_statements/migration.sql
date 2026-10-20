-- Podklady pro fakturaci nájmu kiosku (čl. VI: nájemné = B − C − D − E − F)
CREATE TABLE IF NOT EXISTS "kiosk_rent_statements" (
  "id" SERIAL PRIMARY KEY,
  "subscription_id" INTEGER NOT NULL,
  "kiosk_code" VARCHAR(40) NOT NULL,
  "customer_name" VARCHAR(255),
  "buyer_ico" VARCHAR(20),
  "doc_number" VARCHAR(30),
  "period_ym" VARCHAR(7) NOT NULL,
  "period_from" DATE NOT NULL,
  "period_to" DATE NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'CZK',
  "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 21,
  "fee_pct" DECIMAL(5,2) NOT NULL DEFAULT 13,
  "revenue_sis" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "revenue_adjust" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "lines" JSONB,
  "revenue_gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "revenue_net" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "fee_net" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "cost_d" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "cost_e" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "cost_f" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "rent" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "status" VARCHAR(12) NOT NULL DEFAULT 'draft',
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "kiosk_rent_statements_doc_number_key" ON "kiosk_rent_statements"("doc_number");
CREATE UNIQUE INDEX IF NOT EXISTS "kiosk_rent_statements_subscription_id_period_ym_key" ON "kiosk_rent_statements"("subscription_id", "period_ym");
CREATE INDEX IF NOT EXISTS "kiosk_rent_statements_period_ym_idx" ON "kiosk_rent_statements"("period_ym");
