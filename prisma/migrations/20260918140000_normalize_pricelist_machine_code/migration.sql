-- Sjednocení rozměru stroje na tvar „písmeno+číslo" (18W18D → W18D18, 18W18D18D → W18D18D18).
-- Přehodí každou dvojici číslo+písmeno; týká se jen hodnot začínajících číslem (idempotentní).
UPDATE "sales_pricelist_items"
SET "machine_code" = regexp_replace("machine_code", '([0-9]+)([A-Z])', '\2\1', 'g')
WHERE "machine_code" ~ '^[0-9]';
