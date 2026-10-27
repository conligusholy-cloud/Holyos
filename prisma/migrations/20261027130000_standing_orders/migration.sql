-- Trvalé příkazy (evidence pro výhled plateb)
CREATE TABLE IF NOT EXISTS "standing_orders" (
  "id" SERIAL NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "bank_account_id" INTEGER NOT NULL,
  "recipient_name" VARCHAR(255),
  "recipient_account" VARCHAR(50),
  "variable_symbol" VARCHAR(20),
  "constant_symbol" VARCHAR(10),
  "specific_symbol" VARCHAR(20),
  "message" VARCHAR(140),
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'CZK',
  "frequency" VARCHAR(15) NOT NULL DEFAULT 'monthly',
  "day_of_month" INTEGER NOT NULL,
  "valid_from" DATE NOT NULL,
  "valid_to" DATE,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "standing_orders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "standing_orders_bank_account_id_idx" ON "standing_orders"("bank_account_id");
CREATE INDEX IF NOT EXISTS "standing_orders_active_valid_from_valid_to_idx" ON "standing_orders"("active", "valid_from", "valid_to");
DO $$ BEGIN
  ALTER TABLE "standing_orders" ADD CONSTRAINT "standing_orders_bank_account_id_fkey"
    FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
