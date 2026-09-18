-- HolyOS — Dodací list k prodejní objednávce
CREATE TABLE IF NOT EXISTS "delivery_notes" (
  "id" SERIAL PRIMARY KEY,
  "number" VARCHAR(30) NOT NULL,
  "order_id" INTEGER,
  "company_id" INTEGER,
  "customer_name" VARCHAR(255),
  "date_issued" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "items" JSONB NOT NULL DEFAULT '[]',
  "note" TEXT,
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_notes_number_key" ON "delivery_notes" ("number");
CREATE INDEX IF NOT EXISTS "delivery_notes_order_id_idx" ON "delivery_notes" ("order_id");
