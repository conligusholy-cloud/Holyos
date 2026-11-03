-- Šifrované hodnoty jsou delší než původní VARCHAR — rozšíření na TEXT
ALTER TABLE "people" ALTER COLUMN "bank_account" TYPE TEXT;
ALTER TABLE "people" ALTER COLUMN "birth_number" TYPE TEXT;
ALTER TABLE "people" ALTER COLUMN "id_card_number" TYPE TEXT;
