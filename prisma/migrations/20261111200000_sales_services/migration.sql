-- Služby k prodeji prádlomatů (doporučené služby: doprava, instalace…; kdo platí, cena)
CREATE TABLE IF NOT EXISTS "sales_services" (
  "id" SERIAL NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "category" VARCHAR(100),
  "description" TEXT,
  "payer" VARCHAR(20) NOT NULL DEFAULT 'customer',
  "price_czk" DECIMAL(12,2),
  "price_eur" DECIMAL(12,2),
  "unit" VARCHAR(20) NOT NULL DEFAULT 'paušál',
  "recommended" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_services_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "sales_services_active_sort_order_idx" ON "sales_services"("active", "sort_order");
