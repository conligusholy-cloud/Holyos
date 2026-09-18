-- Obnovení dvou smazaných položek ceníku i s cenami (EUR). Vloží se jen pokud
-- položka se stejným názvem ještě neexistuje (idempotentní, bez duplicit).
INSERT INTO "sales_pricelist_items" ("name_cs", "name_en", "price_eur", "truck_price_eur", "machine_code", "active", "created_at", "updated_at")
SELECT 'Prádlomat 18W18D', 'Laundromat 18W18D', 35000, 33000, 'W18D18', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "sales_pricelist_items" WHERE "name_cs" = 'Prádlomat 18W18D');

INSERT INTO "sales_pricelist_items" ("name_cs", "name_en", "price_eur", "truck_price_eur", "machine_code", "active", "created_at", "updated_at")
SELECT 'Prádlomat 8W18D IE', 'Laundromat 8W18D IE', 52000, 47000, 'W8D18', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "sales_pricelist_items" WHERE "name_cs" = 'Prádlomat 8W18D IE');
