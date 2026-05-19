-- Migration: add_shop_order_pick_batch
-- Spojení ShopOrder ↔ Batch pro auto-pick generování (Fáze 3 brief).
-- Po confirmu objednávky může admin vygenerovat pickovací dávku, která se
-- propojí přes pick_batch_id. Bez FK constraint (informativní pointer).

ALTER TABLE "eshop_orders" ADD COLUMN IF NOT EXISTS "pick_batch_id" INTEGER;
CREATE INDEX IF NOT EXISTS "eshop_orders_pick_batch_id_idx" ON "eshop_orders"("pick_batch_id");
