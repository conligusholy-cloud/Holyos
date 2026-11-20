-- Adresa sídla Nájemce u nájemní smlouvy kiosku (pro podklad k fakturaci)
ALTER TABLE "kiosk_rent_contracts" ADD COLUMN IF NOT EXISTS "buyer_address" TEXT;
