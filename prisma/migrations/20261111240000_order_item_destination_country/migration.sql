-- Země určení u položky objednávky (kam jede prádlomat) — podle ní se přiděluje výrobní číslo z číselné řady
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "destination_country" VARCHAR(2);
-- Rychlé hledání duplicit výrobních čísel (bez ohledu na velikost písmen)
CREATE INDEX IF NOT EXISTS "order_items_serial_number_lower_idx" ON "order_items" (LOWER("serial_number"));
