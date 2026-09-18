-- Zákaznické potvrzení objednávky přes veřejný odkaz /order/<token>
ALTER TABLE "orders" ADD COLUMN "customer_email" VARCHAR(255);
ALTER TABLE "orders" ADD COLUMN "customer_confirmed_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "customer_docs_sent_at" TIMESTAMP(3);
