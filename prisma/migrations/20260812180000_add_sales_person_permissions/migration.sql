-- Práva obchodníka nastavovaná u osoby: dávat slevu + přidávat individuální lokality.
ALTER TABLE "people" ADD COLUMN "can_give_discount" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "people" ADD COLUMN "can_add_individual_offers" BOOLEAN NOT NULL DEFAULT false;
