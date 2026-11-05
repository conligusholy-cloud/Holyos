-- Druh nákupní objednávky (kooperace | vyroba | spotreba | sluzba) a označení
-- vedlejších pořizovacích nákladů na položce (doprava, recyklační poplatek, dobírka).
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "purchase_kind" VARCHAR(20);
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "cost_kind" VARCHAR(20);
-- Dosavadní objednávky: kooperace podle typu, ostatní nákupní bereme jako „do výroby".
UPDATE "orders" SET "purchase_kind" = 'kooperace' WHERE "type" = 'cooperation' AND "purchase_kind" IS NULL;
UPDATE "orders" SET "purchase_kind" = 'vyroba'    WHERE "type" = 'purchase'    AND "purchase_kind" IS NULL;
CREATE INDEX IF NOT EXISTS "orders_purchase_kind_idx" ON "orders" ("purchase_kind");
