-- Migration: add_shop_order_invoice_link
-- Spojení ShopOrder ↔ Invoice — admin může z hotové eshop objednávky
-- vygenerovat fakturu vydanou (issued/ar). FK constraint nepoužíváme (sloupec
-- je informativní, partner nemusí Invoice vidět, hard-delete Invoice nemá
-- důvod blokovat). Idempotentní.

ALTER TABLE "eshop_orders" ADD COLUMN IF NOT EXISTS "invoice_id" INTEGER;
CREATE INDEX IF NOT EXISTS "eshop_orders_invoice_id_idx" ON "eshop_orders"("invoice_id");
