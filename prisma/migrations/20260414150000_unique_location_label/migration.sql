-- Označení skladové pozice musí být unikátní napříč všemi sklady
-- Nejdřív updatuj NULL labely na unikátní hodnoty
UPDATE warehouse_locations SET label = CONCAT('LOC-', id) WHERE label IS NULL;

-- Změň sloupec na NOT NULL
ALTER TABLE "warehouse_locations" ALTER COLUMN "label" SET NOT NULL;

-- Přidej unikátní constraint
CREATE UNIQUE INDEX "warehouse_locations_label_key" ON "warehouse_locations"("label");
