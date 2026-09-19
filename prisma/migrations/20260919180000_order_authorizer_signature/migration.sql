-- Podpis dodavatele (Jan/Tomáš) při autorizaci objednávky
ALTER TABLE "orders" ADD COLUMN "authorizer_signature_data" TEXT;
ALTER TABLE "orders" ADD COLUMN "authorizer_place" VARCHAR(120);
