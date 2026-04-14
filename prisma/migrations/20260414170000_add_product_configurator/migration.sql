-- HolyOS — Produktový konfigurátor (variabilní výbava výrobků)

-- Přidej product_id do order_items
ALTER TABLE "order_items" ADD COLUMN "product_id" INTEGER;
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- Konfigurační skupiny (Rám, Barva opláštění, Polepy, ...)
CREATE TABLE "product_config_groups" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "type" VARCHAR(50) NOT NULL DEFAULT 'single_select',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_config_groups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_config_groups_product_id_idx" ON "product_config_groups"("product_id");
CREATE UNIQUE INDEX "product_config_groups_product_id_code_key" ON "product_config_groups"("product_id", "code");

-- Konfigurační volby (Fe natíraný, Nerez, Antracite grey, ...)
CREATE TABLE "product_config_options" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "price_modifier" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_config_options_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_config_options_group_id_idx" ON "product_config_options"("group_id");
CREATE UNIQUE INDEX "product_config_options_group_id_code_key" ON "product_config_options"("group_id", "code");

-- Vazba volba → materiál (BOM vliv)
CREATE TABLE "config_option_materials" (
    "id" SERIAL NOT NULL,
    "option_id" INTEGER NOT NULL,
    "material_id" INTEGER NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" VARCHAR(20) NOT NULL DEFAULT 'ks',

    CONSTRAINT "config_option_materials_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "config_option_materials_option_id_idx" ON "config_option_materials"("option_id");
CREATE INDEX "config_option_materials_material_id_idx" ON "config_option_materials"("material_id");

-- Vazba volba → operace (pracovní postup vliv)
CREATE TABLE "config_option_operations" (
    "id" SERIAL NOT NULL,
    "option_id" INTEGER NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "modified_duration" INTEGER,
    "note" VARCHAR(255),

    CONSTRAINT "config_option_operations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "config_option_operations_option_id_idx" ON "config_option_operations"("option_id");
CREATE INDEX "config_option_operations_operation_id_idx" ON "config_option_operations"("operation_id");

-- Vybraná konfigurace na položce objednávky
CREATE TABLE "order_item_configs" (
    "id" SERIAL NOT NULL,
    "order_item_id" INTEGER NOT NULL,
    "option_id" INTEGER,
    "custom_value" VARCHAR(500),

    CONSTRAINT "order_item_configs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_item_configs_order_item_id_idx" ON "order_item_configs"("order_item_id");
CREATE INDEX "order_item_configs_option_id_idx" ON "order_item_configs"("option_id");

-- Foreign keys
ALTER TABLE "product_config_groups" ADD CONSTRAINT "product_config_groups_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_config_options" ADD CONSTRAINT "product_config_options_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "product_config_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "config_option_materials" ADD CONSTRAINT "config_option_materials_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "product_config_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "config_option_materials" ADD CONSTRAINT "config_option_materials_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "config_option_operations" ADD CONSTRAINT "config_option_operations_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "product_config_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "config_option_operations" ADD CONSTRAINT "config_option_operations_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "product_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_item_configs" ADD CONSTRAINT "order_item_configs_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_item_configs" ADD CONSTRAINT "order_item_configs_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "product_config_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;
