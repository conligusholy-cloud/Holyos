-- Zastoupení a bankovní spojení zájemce (do rezervační/kupní smlouvy).
ALTER TABLE "location_reservations" ADD COLUMN IF NOT EXISTS "buyer_rep" VARCHAR(255);
ALTER TABLE "location_reservations" ADD COLUMN IF NOT EXISTS "buyer_bank" VARCHAR(120);
