-- HolyOS — kapacita ks/kamion u položky ceníku (pro auto kamionovou cenu)
ALTER TABLE "sales_pricelist_items" ADD COLUMN IF NOT EXISTS "truck_capacity" INTEGER;
