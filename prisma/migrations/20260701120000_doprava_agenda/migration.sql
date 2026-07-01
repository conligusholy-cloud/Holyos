-- HolyOS — Agenda Doprava (kurýr price_on_request + ShippingRequest + provize)
-- Idempotentní (IF NOT EXISTS) kvůli ručnímu apply proti Railway.

-- 1) EshopShippingMethod — příznak "cena na vyžádání"
ALTER TABLE "eshop_shipping_methods"
  ADD COLUMN IF NOT EXISTS "price_on_request" BOOLEAN NOT NULL DEFAULT false;

-- 2) ShopOrder — stav ceny dopravy (defined | pending)
ALTER TABLE "eshop_orders"
  ADD COLUMN IF NOT EXISTS "shipping_price_status" VARCHAR(20) NOT NULL DEFAULT 'defined';

-- 3) EshopSettings — výchozí provize na dopravu (%)
ALTER TABLE "eshop_settings"
  ADD COLUMN IF NOT EXISTS "shipping_markup_pct" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- 4) ShippingRequest — požadavek na dopravu (agenda Doprava)
CREATE TABLE IF NOT EXISTS "shipping_requests" (
  "id"           SERIAL PRIMARY KEY,
  "order_id"     INTEGER NOT NULL,
  "status"       VARCHAR(20) NOT NULL DEFAULT 'new',
  "carrier"      VARCHAR(120),
  "quote_note"   TEXT,
  "currency"     VARCHAR(3) NOT NULL DEFAULT 'EUR',
  "cost_excl"    DECIMAL(10,2) NOT NULL DEFAULT 0,
  "markup_pct"   DECIMAL(5,2) NOT NULL DEFAULT 0,
  "sell_excl"    DECIMAL(10,2) NOT NULL DEFAULT 0,
  "assigned_to"  INTEGER,
  "created_by"   INTEGER,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "quoted_at"    TIMESTAMP(3),
  "confirmed_at" TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "shipping_requests_order_id_idx"    ON "shipping_requests"("order_id");
CREATE INDEX IF NOT EXISTS "shipping_requests_status_idx"      ON "shipping_requests"("status");
CREATE INDEX IF NOT EXISTS "shipping_requests_assigned_to_idx" ON "shipping_requests"("assigned_to");

-- FK (přidáme jen pokud ještě neexistují)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipping_requests_order_id_fkey') THEN
    ALTER TABLE "shipping_requests"
      ADD CONSTRAINT "shipping_requests_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "eshop_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipping_requests_assigned_to_fkey') THEN
    ALTER TABLE "shipping_requests"
      ADD CONSTRAINT "shipping_requests_assigned_to_fkey"
      FOREIGN KEY ("assigned_to") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
