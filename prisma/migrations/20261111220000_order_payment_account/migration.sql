-- Účet pro platby zákazníka u prodejní objednávky (propisuje se na faktury a QR)
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_account_id" INTEGER;
