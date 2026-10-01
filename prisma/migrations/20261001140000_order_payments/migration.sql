-- Rozložení plateb objednávky (splátkový kalendář)
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_scope" VARCHAR(10) NOT NULL DEFAULT 'order';
CREATE TABLE IF NOT EXISTS "order_payments" (
  "id" SERIAL NOT NULL,
  "order_id" INTEGER NOT NULL,
  "order_item_id" INTEGER,
  "seq" INTEGER NOT NULL DEFAULT 0,
  "milestone" VARCHAR(20) NOT NULL,
  "kind" VARCHAR(10) NOT NULL DEFAULT 'deposit',
  "percent" DECIMAL(6,2),
  "amount" DECIMAL(12,2),
  "label" VARCHAR(120),
  "due_days" INTEGER NOT NULL DEFAULT 7,
  "invoice_id" INTEGER,
  "paid" BOOLEAN NOT NULL DEFAULT false,
  "paid_at" TIMESTAMP(3),
  "milestone_at" TIMESTAMP(3),
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "order_payments_order_id_idx" ON "order_payments"("order_id");
CREATE INDEX IF NOT EXISTS "order_payments_order_item_id_idx" ON "order_payments"("order_item_id");
CREATE INDEX IF NOT EXISTS "order_payments_invoice_id_idx" ON "order_payments"("invoice_id");
DO $$ BEGIN
  ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
