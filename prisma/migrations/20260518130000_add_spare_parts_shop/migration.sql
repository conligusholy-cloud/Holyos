-- Migration: add_spare_parts_shop
-- Modul Spare Parts Shop — partner-facing eshop náhradních dílů na
-- bestseries.cash/spare-parts. Sdílí PartnerAccount login s Hugem, vlastní
-- agenda objednávek (ShopOrder) oddělená od výrobních Order.
--
-- Tabulky:
--   eshop_categories         — kategorie zboží (motory, řemeny, čerpadla...)
--   eshop_pricelists         — ceníky (per měna, per firma)
--   eshop_pricelist_items    — položky ceníku (cena per Material)
--   eshop_shipping_methods   — způsoby dopravy (Zásilkovna, kurýr, osobní)
--   eshop_payment_methods    — způsoby platby (převod, dobírka)
--   eshop_orders             — eshopové objednávky (workflow new→...→closed)
--   eshop_order_items        — položky objednávky se snapshotem ceny
--   eshop_settings           — singleton config (notifikace, defaults)
--
-- Rozšíření existujících tabulek:
--   materials  — sells_on_eshop, eshop_warehouse_id, eshop_description,
--                eshop_image_path, eshop_category_id
--   companies  — eshop_pricelist_id
--
-- Seed: 1 EshopPricelist EUR Standard, 3 ShippingMethod, 2 PaymentMethod,
--       1 EshopSettings row.
--
-- Idempotentní — všechny příkazy přežijí opakované spuštění (Railway pattern,
-- memory holyos_prisma_migrate_workflow). FK přidání jdou přes DO $$ blok
-- s NOT EXISTS na pg_constraint.

-- =====================================================================
-- eshop_categories
-- =====================================================================
CREATE TABLE IF NOT EXISTS "eshop_categories" (
  "id"          SERIAL PRIMARY KEY,
  "name"        VARCHAR(100) NOT NULL,
  "slug"        VARCHAR(120) NOT NULL,
  "icon"        VARCHAR(10),
  "description" TEXT,
  "sort_order"  INTEGER NOT NULL DEFAULT 0,
  "parent_id"   INTEGER,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "eshop_categories_name_key" ON "eshop_categories"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "eshop_categories_slug_key" ON "eshop_categories"("slug");
CREATE INDEX IF NOT EXISTS "eshop_categories_parent_id_idx" ON "eshop_categories"("parent_id");
CREATE INDEX IF NOT EXISTS "eshop_categories_sort_order_idx" ON "eshop_categories"("sort_order");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eshop_categories_parent_id_fkey') THEN
    ALTER TABLE "eshop_categories" ADD CONSTRAINT "eshop_categories_parent_id_fkey"
      FOREIGN KEY ("parent_id") REFERENCES "eshop_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- =====================================================================
-- eshop_pricelists
-- =====================================================================
CREATE TABLE IF NOT EXISTS "eshop_pricelists" (
  "id"          SERIAL PRIMARY KEY,
  "name"        VARCHAR(255) NOT NULL,
  "currency"    VARCHAR(3) NOT NULL DEFAULT 'EUR',
  "vat_pct"     DECIMAL(5,2) NOT NULL DEFAULT 21,
  "active"      BOOLEAN NOT NULL DEFAULT TRUE,
  "description" TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "eshop_pricelists_active_idx" ON "eshop_pricelists"("active");

-- =====================================================================
-- eshop_pricelist_items
-- =====================================================================
CREATE TABLE IF NOT EXISTS "eshop_pricelist_items" (
  "id"             SERIAL PRIMARY KEY,
  "pricelist_id"   INTEGER NOT NULL,
  "material_id"    INTEGER NOT NULL,
  "price_excl_vat" DECIMAL(12,2) NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "eshop_pricelist_items_pricelist_material_key"
  ON "eshop_pricelist_items"("pricelist_id", "material_id");
CREATE INDEX IF NOT EXISTS "eshop_pricelist_items_pricelist_id_idx"
  ON "eshop_pricelist_items"("pricelist_id");
CREATE INDEX IF NOT EXISTS "eshop_pricelist_items_material_id_idx"
  ON "eshop_pricelist_items"("material_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eshop_pricelist_items_pricelist_id_fkey') THEN
    ALTER TABLE "eshop_pricelist_items" ADD CONSTRAINT "eshop_pricelist_items_pricelist_id_fkey"
      FOREIGN KEY ("pricelist_id") REFERENCES "eshop_pricelists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eshop_pricelist_items_material_id_fkey') THEN
    ALTER TABLE "eshop_pricelist_items" ADD CONSTRAINT "eshop_pricelist_items_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- =====================================================================
-- eshop_shipping_methods
-- =====================================================================
CREATE TABLE IF NOT EXISTS "eshop_shipping_methods" (
  "id"                SERIAL PRIMARY KEY,
  "name"              VARCHAR(255) NOT NULL,
  "description"       TEXT,
  "price_excl_vat"    DECIMAL(10,2) NOT NULL,
  "vat_pct"           DECIMAL(5,2) NOT NULL DEFAULT 21,
  "free_above_amount" DECIMAL(12,2),
  "currency"          VARCHAR(3) NOT NULL DEFAULT 'EUR',
  "active"            BOOLEAN NOT NULL DEFAULT TRUE,
  "sort_order"        INTEGER NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "eshop_shipping_methods_active_idx" ON "eshop_shipping_methods"("active");

-- =====================================================================
-- eshop_payment_methods
-- =====================================================================
CREATE TABLE IF NOT EXISTS "eshop_payment_methods" (
  "id"           SERIAL PRIMARY KEY,
  "name"         VARCHAR(255) NOT NULL,
  "code"         VARCHAR(50) NOT NULL,
  "description"  TEXT,
  "fee_excl_vat" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "vat_pct"      DECIMAL(5,2) NOT NULL DEFAULT 21,
  "active"       BOOLEAN NOT NULL DEFAULT TRUE,
  "sort_order"   INTEGER NOT NULL DEFAULT 0,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "eshop_payment_methods_code_key" ON "eshop_payment_methods"("code");
CREATE INDEX IF NOT EXISTS "eshop_payment_methods_active_idx" ON "eshop_payment_methods"("active");

-- =====================================================================
-- eshop_orders
-- =====================================================================
CREATE TABLE IF NOT EXISTS "eshop_orders" (
  "id"                  SERIAL PRIMARY KEY,
  "order_number"        VARCHAR(50) NOT NULL,
  "partner_id"          INTEGER NOT NULL,
  "company_id"          INTEGER,
  "shipping_method_id"  INTEGER NOT NULL,
  "payment_method_id"   INTEGER NOT NULL,
  "ship_to_name"        VARCHAR(255) NOT NULL,
  "ship_to_company"     VARCHAR(255),
  "ship_to_address"     VARCHAR(500) NOT NULL,
  "ship_to_city"        VARCHAR(120) NOT NULL,
  "ship_to_zip"         VARCHAR(20) NOT NULL,
  "ship_to_country"     VARCHAR(2) NOT NULL DEFAULT 'CZ',
  "ship_to_email"       VARCHAR(255),
  "ship_to_phone"       VARCHAR(40),
  "customer_note"       TEXT,
  "currency"            VARCHAR(3) NOT NULL,
  "vat_pct"             DECIMAL(5,2) NOT NULL,
  "subtotal_excl"       DECIMAL(12,2) NOT NULL,
  "shipping_excl"       DECIMAL(10,2) NOT NULL,
  "payment_fee_excl"    DECIMAL(10,2) NOT NULL DEFAULT 0,
  "total_excl"          DECIMAL(12,2) NOT NULL,
  "total_incl_vat"      DECIMAL(12,2) NOT NULL,
  "status"              VARCHAR(20) NOT NULL DEFAULT 'new',
  "cancel_reason"       VARCHAR(255),
  "tracking_number"     VARCHAR(100),
  "tracking_carrier"    VARCHAR(60),
  "confirmed_at"        TIMESTAMP(3),
  "picked_at"           TIMESTAMP(3),
  "shipped_at"          TIMESTAMP(3),
  "delivered_at"        TIMESTAMP(3),
  "closed_at"           TIMESTAMP(3),
  "cancelled_at"        TIMESTAMP(3),
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "eshop_orders_order_number_key" ON "eshop_orders"("order_number");
CREATE INDEX IF NOT EXISTS "eshop_orders_partner_id_idx" ON "eshop_orders"("partner_id");
CREATE INDEX IF NOT EXISTS "eshop_orders_company_id_idx" ON "eshop_orders"("company_id");
CREATE INDEX IF NOT EXISTS "eshop_orders_status_idx" ON "eshop_orders"("status");
CREATE INDEX IF NOT EXISTS "eshop_orders_created_at_idx" ON "eshop_orders"("created_at");
CREATE INDEX IF NOT EXISTS "eshop_orders_partner_status_idx" ON "eshop_orders"("partner_id", "status");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eshop_orders_partner_id_fkey') THEN
    ALTER TABLE "eshop_orders" ADD CONSTRAINT "eshop_orders_partner_id_fkey"
      FOREIGN KEY ("partner_id") REFERENCES "partner_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eshop_orders_company_id_fkey') THEN
    ALTER TABLE "eshop_orders" ADD CONSTRAINT "eshop_orders_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eshop_orders_shipping_method_id_fkey') THEN
    ALTER TABLE "eshop_orders" ADD CONSTRAINT "eshop_orders_shipping_method_id_fkey"
      FOREIGN KEY ("shipping_method_id") REFERENCES "eshop_shipping_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eshop_orders_payment_method_id_fkey') THEN
    ALTER TABLE "eshop_orders" ADD CONSTRAINT "eshop_orders_payment_method_id_fkey"
      FOREIGN KEY ("payment_method_id") REFERENCES "eshop_payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- =====================================================================
-- eshop_order_items
-- =====================================================================
CREATE TABLE IF NOT EXISTS "eshop_order_items" (
  "id"              SERIAL PRIMARY KEY,
  "order_id"        INTEGER NOT NULL,
  "material_id"     INTEGER,
  "material_code"   VARCHAR(50) NOT NULL,
  "material_name"   VARCHAR(255) NOT NULL,
  "quantity"        DECIMAL(10,3) NOT NULL,
  "unit"            VARCHAR(20) NOT NULL DEFAULT 'ks',
  "unit_price_excl" DECIMAL(12,2) NOT NULL,
  "total_excl"      DECIMAL(12,2) NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "eshop_order_items_order_id_idx" ON "eshop_order_items"("order_id");
CREATE INDEX IF NOT EXISTS "eshop_order_items_material_id_idx" ON "eshop_order_items"("material_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eshop_order_items_order_id_fkey') THEN
    ALTER TABLE "eshop_order_items" ADD CONSTRAINT "eshop_order_items_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "eshop_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eshop_order_items_material_id_fkey') THEN
    ALTER TABLE "eshop_order_items" ADD CONSTRAINT "eshop_order_items_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- =====================================================================
-- eshop_settings (singleton, id=1)
-- =====================================================================
CREATE TABLE IF NOT EXISTS "eshop_settings" (
  "id"                     SERIAL PRIMARY KEY,
  "notification_email"     VARCHAR(255),
  "notification_person_id" INTEGER,
  "default_currency"       VARCHAR(3) NOT NULL DEFAULT 'EUR',
  "default_vat_pct"        DECIMAL(5,2) NOT NULL DEFAULT 21,
  "reservation_hours"      INTEGER NOT NULL DEFAULT 72,
  "footer_html"            TEXT,
  "contact_email"          VARCHAR(255),
  "contact_phone"          VARCHAR(40),
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eshop_settings_notification_person_id_fkey') THEN
    ALTER TABLE "eshop_settings" ADD CONSTRAINT "eshop_settings_notification_person_id_fkey"
      FOREIGN KEY ("notification_person_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- =====================================================================
-- materials — rozšíření o eshop pole
-- =====================================================================
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "sells_on_eshop"     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "eshop_warehouse_id" INTEGER;
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "eshop_description"  TEXT;
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "eshop_image_path"   VARCHAR(500);
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "eshop_category_id"  INTEGER;

CREATE INDEX IF NOT EXISTS "materials_sells_on_eshop_idx"     ON "materials"("sells_on_eshop");
CREATE INDEX IF NOT EXISTS "materials_eshop_category_id_idx"  ON "materials"("eshop_category_id");
CREATE INDEX IF NOT EXISTS "materials_eshop_warehouse_id_idx" ON "materials"("eshop_warehouse_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'materials_eshop_warehouse_id_fkey') THEN
    ALTER TABLE "materials" ADD CONSTRAINT "materials_eshop_warehouse_id_fkey"
      FOREIGN KEY ("eshop_warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'materials_eshop_category_id_fkey') THEN
    ALTER TABLE "materials" ADD CONSTRAINT "materials_eshop_category_id_fkey"
      FOREIGN KEY ("eshop_category_id") REFERENCES "eshop_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- =====================================================================
-- companies — rozšíření o eshop_pricelist_id
-- =====================================================================
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "eshop_pricelist_id" INTEGER;

CREATE INDEX IF NOT EXISTS "companies_eshop_pricelist_id_idx" ON "companies"("eshop_pricelist_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_eshop_pricelist_id_fkey') THEN
    ALTER TABLE "companies" ADD CONSTRAINT "companies_eshop_pricelist_id_fkey"
      FOREIGN KEY ("eshop_pricelist_id") REFERENCES "eshop_pricelists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- =====================================================================
-- SEED — základní data
-- =====================================================================
-- Idempotentní pattern: INSERT s pevným id + ON CONFLICT DO NOTHING.
-- Po INSERTu resetujeme sekvenci, aby další INSERT bez pevného id dostal
-- správné autoincrement id (jinak by sequence ukazovala na 1 a kolidovala).

-- 1) EshopPricelist "Standard EUR" (id=1)
INSERT INTO "eshop_pricelists" ("id", "name", "currency", "vat_pct", "active", "description", "created_at", "updated_at")
VALUES (1, 'Standard EUR', 'EUR', 21, TRUE, 'Výchozí ceník pro EU partnery — EUR, DPH 21 %', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
SELECT setval(pg_get_serial_sequence('eshop_pricelists', 'id'),
              GREATEST((SELECT COALESCE(MAX("id"), 1) FROM "eshop_pricelists"), 1));

-- 2) EshopShippingMethod — Zásilkovna / Kurýr / Osobní odběr (id 1,2,3)
INSERT INTO "eshop_shipping_methods"
  ("id", "name", "description", "price_excl_vat", "vat_pct", "free_above_amount", "currency", "active", "sort_order", "created_at", "updated_at")
VALUES
  (1, 'Zásilkovna', 'Doručení na výdejní místo Zásilkovny v rámci EU. Obvykle 2–3 prac. dny.',     5.00,  21, 150.00, 'EUR', TRUE, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (2, 'Kurýr (na adresu)', 'Přepravce DPD/GLS na zadanou adresu, doručení do 48 h v ČR.',           15.00, 21, 300.00, 'EUR', TRUE, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (3, 'Osobní odběr', 'Osobní vyzvednutí ve výrobě Best Series po dohodě (Velké Hamry).',           0.00,  21, NULL,   'EUR', TRUE, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
SELECT setval(pg_get_serial_sequence('eshop_shipping_methods', 'id'),
              GREATEST((SELECT COALESCE(MAX("id"), 1) FROM "eshop_shipping_methods"), 1));

-- 3) EshopPaymentMethod — Bankovní převod / Dobírka (id 1,2)
INSERT INTO "eshop_payment_methods"
  ("id", "name", "code", "description", "fee_excl_vat", "vat_pct", "active", "sort_order", "created_at", "updated_at")
VALUES
  (1, 'Bankovní převod', 'bank_transfer', 'Platba na účet podle vystavené proforma faktury. Zboží odesíláme po připsání.', 0.00, 21, TRUE, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (2, 'Dobírka',         'cod',           'Platba kurýrovi/Zásilkovně při převzetí. Příplatek za dobírku 3 €.',           3.00, 21, TRUE, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
SELECT setval(pg_get_serial_sequence('eshop_payment_methods', 'id'),
              GREATEST((SELECT COALESCE(MAX("id"), 1) FROM "eshop_payment_methods"), 1));

-- 4) EshopSettings singleton (id=1)
INSERT INTO "eshop_settings"
  ("id", "notification_email", "notification_person_id", "default_currency", "default_vat_pct", "reservation_hours", "created_at", "updated_at")
VALUES
  (1, NULL, NULL, 'EUR', 21, 72, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
SELECT setval(pg_get_serial_sequence('eshop_settings', 'id'),
              GREATEST((SELECT COALESCE(MAX("id"), 1) FROM "eshop_settings"), 1));
