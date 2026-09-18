-- Doplnění sloupce "stroj" u stávajících položek ceníku z názvu
-- (např. „Prádlomat 18W18D18D IE" → 18W18D18D, „Prádlomat Skelet 8W18D IE" → 8W18D).
UPDATE "sales_pricelist_items"
SET "machine_code" = substring("name_cs" from '([0-9]+W[0-9]+D(?:[0-9]+D)*)')
WHERE "machine_code" IS NULL
  AND "name_cs" ~ '[0-9]+W[0-9]+D';
