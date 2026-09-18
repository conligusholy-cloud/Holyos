-- Podpis zákazníka + autorizace objednávky (Tomáš/Jan) ve schvalovacím flow
ALTER TABLE "orders" ADD COLUMN "signature_data" TEXT;
ALTER TABLE "orders" ADD COLUMN "signature_place" VARCHAR(120);
ALTER TABLE "orders" ADD COLUMN "signed_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "authorized_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "authorized_by_user_id" INTEGER;
