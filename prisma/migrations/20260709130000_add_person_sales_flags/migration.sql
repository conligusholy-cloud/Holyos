-- Obchod: nezávislé přístupové flagy k obchodním obrazovkám (mimo hlavní roli osoby).
-- is_salesperson = obrazovka obchodníka + kandidát na vlastníka kontaktu.
-- is_sales_lead  = obrazovka vedoucího obchodu.
ALTER TABLE "people" ADD COLUMN "is_salesperson" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "people" ADD COLUMN "is_sales_lead" BOOLEAN NOT NULL DEFAULT false;
