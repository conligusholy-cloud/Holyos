-- Migration: add_order_payment_tracking
-- Sledování platby (záloha/doplatek) na prodejní objednávce a auto-uvolnění do výroby.
-- Související feature: Order.status=='ordered' → 'confirmed' při zaplacení podle pravidel.

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "payment_split"      BOOLEAN       NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "deposit_amount"     DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "deposit_percent"    INTEGER,
  ADD COLUMN IF NOT EXISTS "deposit_paid"       BOOLEAN       NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "deposit_paid_at"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "final_paid"         BOOLEAN       NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "final_paid_at"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "release_on_deposit" BOOLEAN       NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "released_at"        TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "orders_deposit_paid_idx" ON "orders" ("deposit_paid");
CREATE INDEX IF NOT EXISTS "orders_final_paid_idx"   ON "orders" ("final_paid");
CREATE INDEX IF NOT EXISTS "orders_released_at_idx"  ON "orders" ("released_at");
