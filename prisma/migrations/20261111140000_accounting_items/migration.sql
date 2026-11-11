-- Účetní položky: samostatný ruční seznam (mimo sklad)
CREATE TABLE IF NOT EXISTS "accounting_items" (
  "id" SERIAL NOT NULL,
  "code" VARCHAR(50),
  "name" VARCHAR(255) NOT NULL,
  "category" VARCHAR(100),
  "unit" VARCHAR(20) NOT NULL DEFAULT 'ks',
  "unit_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "vat_rate" DECIMAL(5,2),
  "account_no" VARCHAR(30),
  "supplier" VARCHAR(255),
  "note" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "accounting_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "accounting_items_name_idx" ON "accounting_items"("name");
CREATE INDEX IF NOT EXISTS "accounting_items_active_idx" ON "accounting_items"("active");
