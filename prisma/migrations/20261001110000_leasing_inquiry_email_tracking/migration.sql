-- Leasing poptávky: sledování doručení a otevření e-mailu
ALTER TABLE "leasing_inquiries" ADD COLUMN IF NOT EXISTS "email_opened_at" TIMESTAMP(3);
ALTER TABLE "leasing_inquiries" ADD COLUMN IF NOT EXISTS "email_delivery" VARCHAR(20);
ALTER TABLE "leasing_inquiries" ADD COLUMN IF NOT EXISTS "email_delivery_at" TIMESTAMP(3);
ALTER TABLE "leasing_inquiries" ADD COLUMN IF NOT EXISTS "email_delivery_note" VARCHAR(500);
