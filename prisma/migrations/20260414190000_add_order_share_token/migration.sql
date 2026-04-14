-- Přidej sdílecí token pro objednávky (veřejný odkaz pro zákazníka)
ALTER TABLE "orders" ADD COLUMN "share_token" VARCHAR(64);
CREATE UNIQUE INDEX "orders_share_token_key" ON "orders"("share_token");
