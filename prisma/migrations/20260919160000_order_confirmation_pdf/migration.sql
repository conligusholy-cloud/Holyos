-- PDF potvrzené objednávky uložené k objednávce (cesta na data volume)
ALTER TABLE "orders" ADD COLUMN "confirmation_pdf_path" VARCHAR(500);
