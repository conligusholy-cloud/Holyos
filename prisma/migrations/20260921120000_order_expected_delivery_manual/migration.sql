-- Order: příznak, že „datum slíbené zákazníkovi" zadal ručně obchodník
-- (jinak se dopočítává automaticky = konec posledního výrobního slotu + 10 dní).
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "expected_delivery_manual" BOOLEAN NOT NULL DEFAULT false;
