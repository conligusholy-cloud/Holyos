-- Chybějící sloupec z commitu "Rozliš plátce DPH" (DIČ / VAT ID kupujícího na rezervaci).
ALTER TABLE "location_reservations" ADD COLUMN IF NOT EXISTS "buyer_dic" VARCHAR(20);
