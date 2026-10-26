-- Poptávky u dodavatelů (poptávkový list s odkazem) + položky s nabídnutou cenou a dodací lhůtou
CREATE TABLE IF NOT EXISTS "purchase_inquiries" (
  "id" SERIAL PRIMARY KEY,
  "number" VARCHAR(30) NOT NULL,
  "company_id" INTEGER NOT NULL,
  "contact_person_id" INTEGER,
  "contact_email" VARCHAR(255),
  "contact_name" VARCHAR(255),
  "token" VARCHAR(64) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'CZK',
  "required_delivery" DATE,
  "note" TEXT,
  "supplier_note" TEXT,
  "supplier_name" VARCHAR(255),
  "order_id" INTEGER,
  "created_by" INTEGER,
  "sent_at" TIMESTAMP(3),
  "opened_at" TIMESTAMP(3),
  "saved_at" TIMESTAMP(3),
  "answered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_inquiries_number_key" ON "purchase_inquiries"("number");
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_inquiries_token_key" ON "purchase_inquiries"("token");
CREATE INDEX IF NOT EXISTS "purchase_inquiries_company_id_idx" ON "purchase_inquiries"("company_id");
CREATE INDEX IF NOT EXISTS "purchase_inquiries_status_idx" ON "purchase_inquiries"("status");

CREATE TABLE IF NOT EXISTS "purchase_inquiry_items" (
  "id" SERIAL PRIMARY KEY,
  "inquiry_id" INTEGER NOT NULL,
  "line_order" INTEGER NOT NULL DEFAULT 0,
  "material_id" INTEGER,
  "name" VARCHAR(255) NOT NULL,
  "code" VARCHAR(100),
  "quantity" DECIMAL(12,3) NOT NULL,
  "unit" VARCHAR(20) NOT NULL DEFAULT 'ks',
  "needed_by" DATE,
  "offered_price" DECIMAL(12,4),
  "lead_time_days" INTEGER,
  "offered_delivery" DATE,
  "min_order_qty" DECIMAL(12,3),
  "supplier_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_inquiry_items_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "purchase_inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "purchase_inquiry_items_inquiry_id_idx" ON "purchase_inquiry_items"("inquiry_id");
CREATE INDEX IF NOT EXISTS "purchase_inquiry_items_material_id_idx" ON "purchase_inquiry_items"("material_id");
