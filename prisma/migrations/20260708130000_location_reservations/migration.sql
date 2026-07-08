-- Rezervace lokalit (prádlomatů) k prodeji
CREATE TABLE IF NOT EXISTS "location_reservations" (
  "id" SERIAL PRIMARY KEY,
  "kiosk_code" VARCHAR(40) NOT NULL,
  "lead_id" INTEGER,
  "buyer_name" VARCHAR(255),
  "buyer_email" VARCHAR(255),
  "buyer_phone" VARCHAR(40),
  "buyer_ico" VARCHAR(20),
  "buyer_address" TEXT,
  "days" INTEGER NOT NULL DEFAULT 0,
  "fee_per_day" INTEGER NOT NULL DEFAULT 0,
  "fee_total" INTEGER NOT NULL DEFAULT 0,
  "purchase_price" INTEGER,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'CZK',
  "status" VARCHAR(20) NOT NULL DEFAULT 'reserved',
  "sign_until" TIMESTAMP(3),
  "fee_until" TIMESTAMP(3),
  "reserved_until" TIMESTAMP(3),
  "fee_paid_at" TIMESTAMP(3),
  "purchase_paid_at" TIMESTAMP(3),
  "signed_at" TIMESTAMP(3),
  "cancel_reason" VARCHAR(200),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "location_reservations_kiosk_code_idx" ON "location_reservations"("kiosk_code");
CREATE INDEX IF NOT EXISTS "location_reservations_status_idx" ON "location_reservations"("status");
CREATE INDEX IF NOT EXISTS "location_reservations_lead_id_idx" ON "location_reservations"("lead_id");
