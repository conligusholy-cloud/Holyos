-- =============================================================================
-- HolyOS — Factorify warehouse import: schema doplňky
-- 2026-04-28
--
-- Co dělá:
--   - Přidává factorify_id (+ index) na 8 existujících tabulek pro idempotentní párování:
--     warehouses, companies, orders, order_items, inventory_movements,
--     inventories, inventory_items, cost_centers, warehouse_documents
--   - Přidává JSONB factorify_metadata na orders (Best Series custom pole STAV/DUVOD/POPT/SCHASTAV/PLAT)
--   - Přidává cost_center_id + project_id na orders a warehouse_documents
--   - Přidává hala_code na warehouses (HALA1..HALA4 kategorie z Factorify Stock)
--   - Přidává factorify_state, factorify_moved_at, factorify_document_id na inventory_movements
--   - Přidává factorify_type na warehouse_documents
--   - Vytváří 3 nové tabulky: projects, supplier_price_lists, supplier_price_list_items
--   - Vytváří FK constraints pro nové vazby
--
-- Idempotence: VŠE používá `IF NOT EXISTS` / `IF EXISTS`, lze pustit opakovaně.
-- =============================================================================

-- ─── EXISTUJÍCÍ TABULKY: factorify_id + doplňková pole ────────────────────────

ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "factorify_id" VARCHAR(100);
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "hala_code" VARCHAR(20);
CREATE INDEX IF NOT EXISTS "warehouses_factorify_id_idx" ON "warehouses"("factorify_id");

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "factorify_id" VARCHAR(100);
CREATE INDEX IF NOT EXISTS "companies_factorify_id_idx" ON "companies"("factorify_id");

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "factorify_id" VARCHAR(100);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "factorify_metadata" JSONB;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cost_center_id" INTEGER;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "project_id" INTEGER;
CREATE INDEX IF NOT EXISTS "orders_factorify_id_idx" ON "orders"("factorify_id");
CREATE INDEX IF NOT EXISTS "orders_cost_center_id_idx" ON "orders"("cost_center_id");
CREATE INDEX IF NOT EXISTS "orders_project_id_idx" ON "orders"("project_id");

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "factorify_id" VARCHAR(100);
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "factorify_price_list_item_id" VARCHAR(100);
CREATE INDEX IF NOT EXISTS "order_items_factorify_id_idx" ON "order_items"("factorify_id");

ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "factorify_id" VARCHAR(100);
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "factorify_document_id" VARCHAR(100);
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "factorify_state" VARCHAR(20);
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "factorify_moved_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "inventory_movements_factorify_id_idx" ON "inventory_movements"("factorify_id");
CREATE INDEX IF NOT EXISTS "inventory_movements_factorify_document_id_idx" ON "inventory_movements"("factorify_document_id");

ALTER TABLE "inventories" ADD COLUMN IF NOT EXISTS "factorify_id" VARCHAR(100);
CREATE INDEX IF NOT EXISTS "inventories_factorify_id_idx" ON "inventories"("factorify_id");

ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "factorify_id" VARCHAR(100);
CREATE INDEX IF NOT EXISTS "inventory_items_factorify_id_idx" ON "inventory_items"("factorify_id");

ALTER TABLE "cost_centers" ADD COLUMN IF NOT EXISTS "factorify_id" VARCHAR(100);
CREATE INDEX IF NOT EXISTS "cost_centers_factorify_id_idx" ON "cost_centers"("factorify_id");

ALTER TABLE "warehouse_documents" ADD COLUMN IF NOT EXISTS "factorify_id" VARCHAR(100);
ALTER TABLE "warehouse_documents" ADD COLUMN IF NOT EXISTS "factorify_type" VARCHAR(50);
ALTER TABLE "warehouse_documents" ADD COLUMN IF NOT EXISTS "cost_center_id" INTEGER;
ALTER TABLE "warehouse_documents" ADD COLUMN IF NOT EXISTS "project_id" INTEGER;
CREATE INDEX IF NOT EXISTS "warehouse_documents_factorify_id_idx" ON "warehouse_documents"("factorify_id");
CREATE INDEX IF NOT EXISTS "warehouse_documents_cost_center_id_idx" ON "warehouse_documents"("cost_center_id");
CREATE INDEX IF NOT EXISTS "warehouse_documents_project_id_idx" ON "warehouse_documents"("project_id");

-- ─── NOVÉ TABULKY ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "projects" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(50),
    "name" VARCHAR(255) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "factorify_id" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "projects_factorify_id_idx" ON "projects"("factorify_id");
CREATE INDEX IF NOT EXISTS "projects_code_idx" ON "projects"("code");

CREATE TABLE IF NOT EXISTS "supplier_price_lists" (
    "id" SERIAL NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "material_id" INTEGER NOT NULL,
    "valid_from" DATE,
    "valid_to" DATE,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_valid" BOOLEAN NOT NULL DEFAULT true,
    "country_of_origin" VARCHAR(2),
    "note" TEXT,
    "factorify_id" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supplier_price_lists_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "supplier_price_lists_factorify_id_idx" ON "supplier_price_lists"("factorify_id");
CREATE INDEX IF NOT EXISTS "supplier_price_lists_supplier_id_idx" ON "supplier_price_lists"("supplier_id");
CREATE INDEX IF NOT EXISTS "supplier_price_lists_material_id_idx" ON "supplier_price_lists"("material_id");
CREATE INDEX IF NOT EXISTS "supplier_price_lists_is_primary_idx" ON "supplier_price_lists"("is_primary");

CREATE TABLE IF NOT EXISTS "supplier_price_list_items" (
    "id" SERIAL NOT NULL,
    "price_list_id" INTEGER NOT NULL,
    "quantity_min" DECIMAL(12,2),
    "price" DECIMAL(12,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CZK',
    "additional_cost" DECIMAL(12,4),
    "additional_cost_currency" VARCHAR(3),
    "min_order_quantity" DECIMAL(12,2),
    "delivery_time_days" INTEGER,
    "supplier_part_no" VARCHAR(100),
    "factorify_id" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supplier_price_list_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "supplier_price_list_items_factorify_id_idx" ON "supplier_price_list_items"("factorify_id");
CREATE INDEX IF NOT EXISTS "supplier_price_list_items_price_list_id_idx" ON "supplier_price_list_items"("price_list_id");

-- ─── FOREIGN KEYS (nové vazby) ────────────────────────────────────────────────
-- Pozn.: PostgreSQL nemá ALTER TABLE ADD CONSTRAINT IF NOT EXISTS, řešíme přes DO block.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_cost_center_id_fkey'
    ) THEN
        ALTER TABLE "orders" ADD CONSTRAINT "orders_cost_center_id_fkey"
            FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_project_id_fkey'
    ) THEN
        ALTER TABLE "orders" ADD CONSTRAINT "orders_project_id_fkey"
            FOREIGN KEY ("project_id") REFERENCES "projects"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_documents_cost_center_id_fkey'
    ) THEN
        ALTER TABLE "warehouse_documents" ADD CONSTRAINT "warehouse_documents_cost_center_id_fkey"
            FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_documents_project_id_fkey'
    ) THEN
        ALTER TABLE "warehouse_documents" ADD CONSTRAINT "warehouse_documents_project_id_fkey"
            FOREIGN KEY ("project_id") REFERENCES "projects"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'supplier_price_lists_supplier_id_fkey'
    ) THEN
        ALTER TABLE "supplier_price_lists" ADD CONSTRAINT "supplier_price_lists_supplier_id_fkey"
            FOREIGN KEY ("supplier_id") REFERENCES "companies"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'supplier_price_lists_material_id_fkey'
    ) THEN
        ALTER TABLE "supplier_price_lists" ADD CONSTRAINT "supplier_price_lists_material_id_fkey"
            FOREIGN KEY ("material_id") REFERENCES "materials"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'supplier_price_list_items_price_list_id_fkey'
    ) THEN
        ALTER TABLE "supplier_price_list_items" ADD CONSTRAINT "supplier_price_list_items_price_list_id_fkey"
            FOREIGN KEY ("price_list_id") REFERENCES "supplier_price_lists"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END$$;
