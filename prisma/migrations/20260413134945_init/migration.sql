-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "display_name" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'user',
    "is_super_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token" VARCHAR(500) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" SERIAL NOT NULL,
    "type" VARCHAR(50) NOT NULL DEFAULT 'employee',
    "first_name" VARCHAR(255) NOT NULL,
    "last_name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(20),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "employee_number" VARCHAR(50),
    "hire_date" DATE,
    "end_date" DATE,
    "contract_type" VARCHAR(50),
    "hourly_rate" DECIMAL(10,2),
    "monthly_salary" DECIMAL(10,2),
    "bank_account" VARCHAR(50),
    "birth_date" DATE,
    "birth_number" VARCHAR(20),
    "id_card_number" VARCHAR(20),
    "gender" VARCHAR(10),
    "address" VARCHAR(255),
    "city" VARCHAR(100),
    "zip" VARCHAR(10),
    "emergency_name" VARCHAR(255),
    "emergency_phone" VARCHAR(20),
    "emergency_relation" VARCHAR(100),
    "photo_url" TEXT,
    "chip_number" VARCHAR(50),
    "chip_card_id" VARCHAR(50),
    "is_super_admin" BOOLEAN NOT NULL DEFAULT false,
    "username" VARCHAR(100),
    "leave_entitlement_days" INTEGER,
    "leave_carryover" INTEGER,
    "department_id" INTEGER,
    "role_id" INTEGER,
    "supervisor_id" INTEGER,
    "shift_id" INTEGER,
    "user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "color" VARCHAR(7),
    "parent_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "department_id" INTEGER,
    "parent_role_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'fixed',
    "start_time" VARCHAR(5),
    "end_time" VARCHAR(5),
    "hours_fund" DECIMAL(5,2) NOT NULL DEFAULT 8.0,
    "break_minutes" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" SERIAL NOT NULL,
    "person_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "clock_in" VARCHAR(5),
    "clock_out" VARCHAR(5),
    "break_minutes" INTEGER NOT NULL DEFAULT 30,
    "type" VARCHAR(50) NOT NULL DEFAULT 'work',
    "note" TEXT,
    "adjusted_clock_in" VARCHAR(5),
    "adjusted_clock_out" VARCHAR(5),
    "adjusted_break" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absence_types" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "color" VARCHAR(7),
    "paid" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "absence_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" SERIAL NOT NULL,
    "person_id" INTEGER NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "date_from" DATE NOT NULL,
    "date_to" DATE NOT NULL,
    "note" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "approved_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_leave" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "date_from" DATE NOT NULL,
    "date_to" DATE NOT NULL,
    "excluded_person_ids" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_leave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" SERIAL NOT NULL,
    "role_id" INTEGER NOT NULL,
    "module_id" VARCHAR(100) NOT NULL,
    "access_level" VARCHAR(20) NOT NULL DEFAULT 'none',

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "default_entitlement_days" INTEGER NOT NULL DEFAULT 20,
    "year" INTEGER NOT NULL DEFAULT 2026,
    "carryover_allowed" BOOLEAN NOT NULL DEFAULT true,
    "carryover_max_days" INTEGER NOT NULL DEFAULT 5,

    CONSTRAINT "leave_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overtime_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "yearly_limit_hours" INTEGER NOT NULL DEFAULT 150,
    "yearly_absolute_max" INTEGER NOT NULL DEFAULT 416,
    "alert_threshold_percent" INTEGER NOT NULL DEFAULT 80,
    "compensation" VARCHAR(20) NOT NULL DEFAULT 'surcharge',
    "surcharge_percent" INTEGER NOT NULL DEFAULT 25,
    "allow_monthly_transfer" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "overtime_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" SERIAL NOT NULL,
    "person_id" INTEGER NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "category" VARCHAR(50),
    "file_data" TEXT,
    "file_name" VARCHAR(255),
    "file_type" VARCHAR(50),
    "file_size" INTEGER,
    "valid_from" DATE,
    "valid_to" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "tags" JSONB,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_templates" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "category" VARCHAR(50),
    "content" TEXT NOT NULL,
    "variables" JSONB,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_notifications" (
    "id" SERIAL NOT NULL,
    "document_id" INTEGER NOT NULL,
    "person_id" INTEGER NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "trigger_days_before" INTEGER,
    "message" VARCHAR(255),
    "sent_at" TIMESTAMP(3),
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "ico" VARCHAR(20),
    "dic" VARCHAR(20),
    "address" VARCHAR(255),
    "city" VARCHAR(100),
    "zip" VARCHAR(10),
    "country" VARCHAR(2) NOT NULL DEFAULT 'CZ',
    "type" VARCHAR(50) NOT NULL,
    "contact_person" VARCHAR(255),
    "email" VARCHAR(255),
    "phone" VARCHAR(20),
    "web" VARCHAR(255),
    "bank_account" VARCHAR(50),
    "payment_terms_days" INTEGER NOT NULL DEFAULT 14,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "order_number" VARCHAR(50) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "company_id" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'new',
    "items_count" INTEGER NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CZK',
    "note" TEXT,
    "created_by" INTEGER,
    "approved_by" INTEGER,
    "expected_delivery" DATE,
    "delivered_at" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "material_id" INTEGER,
    "name" VARCHAR(255) NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit" VARCHAR(20) NOT NULL DEFAULT 'ks',
    "unit_price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "expected_delivery" DATE,
    "delivered_quantity" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "note" TEXT,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(50),
    "address" VARCHAR(255),
    "type" VARCHAR(50) NOT NULL DEFAULT 'main',
    "manager_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_locations" (
    "id" SERIAL NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "section" VARCHAR(50),
    "rack" VARCHAR(50),
    "position" VARCHAR(50),
    "label" VARCHAR(255),
    "barcode" VARCHAR(100),
    "capacity" DECIMAL(10,2),
    "notes" TEXT,

    CONSTRAINT "warehouse_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "external_id" VARCHAR(100),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "type" VARCHAR(50) NOT NULL DEFAULT 'material',
    "unit" VARCHAR(20) NOT NULL DEFAULT 'ks',
    "barcode" VARCHAR(100),
    "unit_price" DECIMAL(10,2),
    "weighted_avg_price" DECIMAL(10,2),
    "current_stock" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "min_stock" DECIMAL(10,2),
    "max_stock" DECIMAL(10,2),
    "min_stock_type" VARCHAR(20),
    "max_stock_type" VARCHAR(20),
    "supplier_id" INTEGER,
    "lead_time_days" DECIMAL(5,2),
    "batch_size_min" DECIMAL(10,2),
    "batch_size_max" DECIMAL(10,2),
    "batch_size_default" DECIMAL(10,2),
    "processed_in_multiples" DECIMAL(10,2),
    "reorder_quantity" DECIMAL(10,2),
    "expedition_reserve_days" DECIMAL(5,2),
    "delivery_tolerance_pct" DECIMAL(5,2),
    "plan_orders" BOOLEAN NOT NULL DEFAULT false,
    "classification" VARCHAR(50),
    "family" VARCHAR(100),
    "material_group" VARCHAR(100),
    "norm" VARCHAR(100),
    "weight" DECIMAL(10,3),
    "dimension" VARCHAR(255),
    "color" VARCHAR(7),
    "secondary_color" VARCHAR(7),
    "material_ref" VARCHAR(100),
    "semi_product_ref" VARCHAR(100),
    "route" VARCHAR(100),
    "revision_number" VARCHAR(50),
    "order_number" VARCHAR(100),
    "position" VARCHAR(100),
    "drawn_by" VARCHAR(100),
    "toolbox_name" VARCHAR(255),
    "solid_name" VARCHAR(100),
    "non_stock" BOOLEAN NOT NULL DEFAULT false,
    "distinguish_batches" BOOLEAN NOT NULL DEFAULT false,
    "interchangeable_batches" BOOLEAN NOT NULL DEFAULT false,
    "no_availability_check" BOOLEAN NOT NULL DEFAULT false,
    "check_availability_stage" BOOLEAN NOT NULL DEFAULT false,
    "check_availability_expedition" BOOLEAN NOT NULL DEFAULT false,
    "mandatory_scan" BOOLEAN NOT NULL DEFAULT false,
    "save_sn_first_scan" BOOLEAN NOT NULL DEFAULT false,
    "temp_barcode" BOOLEAN NOT NULL DEFAULT false,
    "auto_complete_after_bom_scan" BOOLEAN NOT NULL DEFAULT false,
    "exact_consumption" BOOLEAN NOT NULL DEFAULT false,
    "ignore" BOOLEAN NOT NULL DEFAULT false,
    "ignore_forecast_eval" BOOLEAN NOT NULL DEFAULT false,
    "split_receipt_by_sales_items" BOOLEAN NOT NULL DEFAULT false,
    "expirable" BOOLEAN NOT NULL DEFAULT false,
    "shelf_life" VARCHAR(20),
    "shelf_life_unit" VARCHAR(20),
    "max_acceptable_shelf_life_pct" DECIMAL(5,2),
    "allow_rotation" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER,
    "release_before_dispatch_days" DECIMAL(5,2),
    "forecast_pct" DECIMAL(5,2),
    "sort_weight" DECIMAL(10,2),
    "daily_target" DECIMAL(10,2),
    "stock_substitution" VARCHAR(50),
    "internal_status" VARCHAR(50),
    "valid_from" DATE,
    "valid_to" DATE,
    "customers" TEXT,
    "internal_value" VARCHAR(100),
    "active_flag" VARCHAR(20),
    "export_state" VARCHAR(50),
    "accounting_unit" VARCHAR(50),
    "goods_template" VARCHAR(100),
    "sn_mask" VARCHAR(50),
    "uses_service_eshop" BOOLEAN NOT NULL DEFAULT false,
    "alt_unit" VARCHAR(20),
    "alt_unit_coeff" DECIMAL(10,2),
    "similar_goods" VARCHAR(255),
    "alt_goods" VARCHAR(255),
    "alt_goods_forecast" VARCHAR(255),
    "target_warehouse" VARCHAR(50),
    "wait_after_stock_hours" DECIMAL(5,2),
    "keywords" TEXT,
    "photo_url" TEXT,
    "description" TEXT,
    "production_note" TEXT,
    "factorify_id" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" SERIAL NOT NULL,
    "material_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "location_id" INTEGER,
    "type" VARCHAR(20) NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_price" DECIMAL(10,2),
    "reference_type" VARCHAR(50),
    "reference_id" INTEGER,
    "note" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_rules" (
    "id" SERIAL NOT NULL,
    "material_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER,
    "min_stock" DECIMAL(10,2),
    "max_stock" DECIMAL(10,2),
    "reorder_quantity" DECIMAL(10,2),
    "auto_order" BOOLEAN NOT NULL DEFAULT false,
    "preferred_supplier_id" INTEGER,
    "notes" TEXT,

    CONSTRAINT "stock_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventories" (
    "id" SERIAL NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_by" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" SERIAL NOT NULL,
    "inventory_id" INTEGER NOT NULL,
    "material_id" INTEGER NOT NULL,
    "location_id" INTEGER,
    "expected_qty" DECIMAL(10,2) NOT NULL,
    "actual_qty" DECIMAL(10,2),
    "difference" DECIMAL(10,2),
    "unit_price" DECIMAL(10,2),
    "value_difference" DECIMAL(12,2),
    "counted_by" INTEGER,
    "counted_at" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_tasks" (
    "id" SERIAL NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'new',
    "priority" VARCHAR(20) NOT NULL DEFAULT 'medium',
    "page" VARCHAR(255),
    "page_title" VARCHAR(255),
    "description" TEXT,
    "spec" TEXT,
    "ai_questions" JSONB,
    "ai_answers" JSONB,
    "screenshot" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_name" VARCHAR(100),
    "user_display" VARCHAR(255),
    "action" VARCHAR(20) NOT NULL,
    "entity" VARCHAR(50) NOT NULL,
    "entity_id" INTEGER,
    "description" TEXT,
    "changes" JSONB,
    "snapshot" JSONB,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mindmap_notes" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "content" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mindmap_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" VARCHAR(50) NOT NULL DEFAULT 'product',
    "factorify_id" INTEGER,
    "material_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workstations" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(50),
    "factorify_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workstations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_operations" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "workstation_id" INTEGER,
    "step_number" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "phase" VARCHAR(255),
    "duration" INTEGER,
    "duration_unit" VARCHAR(20) NOT NULL DEFAULT 'MINUTE',
    "preparation_time" INTEGER NOT NULL DEFAULT 0,
    "bom_count" INTEGER,

    CONSTRAINT "product_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulations" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "objects" JSONB NOT NULL,
    "connections" JSONB,
    "viewport" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "simulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistants" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "role" TEXT NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "model" VARCHAR(100) NOT NULL DEFAULT 'claude-sonnet-4-6',
    "avatar_url" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "handler_type" VARCHAR(50) NOT NULL,
    "handler_config" JSONB,
    "input_schema" JSONB,
    "output_schema" JSONB,
    "requires_auth" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_skills" (
    "assistant_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "config_override" JSONB,

    CONSTRAINT "assistant_skills_pkey" PRIMARY KEY ("assistant_id","skill_id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "assistant_id" TEXT NOT NULL,
    "title" VARCHAR(255),
    "context" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "skill_calls" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_executions" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "status" VARCHAR(20) NOT NULL,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_token_idx" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "people_user_id_key" ON "people"("user_id");

-- CreateIndex
CREATE INDEX "people_department_id_idx" ON "people"("department_id");

-- CreateIndex
CREATE INDEX "people_role_id_idx" ON "people"("role_id");

-- CreateIndex
CREATE INDEX "people_active_idx" ON "people"("active");

-- CreateIndex
CREATE INDEX "people_chip_number_idx" ON "people"("chip_number");

-- CreateIndex
CREATE INDEX "people_chip_card_id_idx" ON "people"("chip_card_id");

-- CreateIndex
CREATE INDEX "attendance_person_id_date_idx" ON "attendance"("person_id", "date");

-- CreateIndex
CREATE INDEX "attendance_date_idx" ON "attendance"("date");

-- CreateIndex
CREATE UNIQUE INDEX "absence_types_code_key" ON "absence_types"("code");

-- CreateIndex
CREATE INDEX "leave_requests_person_id_idx" ON "leave_requests"("person_id");

-- CreateIndex
CREATE INDEX "leave_requests_status_idx" ON "leave_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_role_id_module_id_key" ON "permissions"("role_id", "module_id");

-- CreateIndex
CREATE INDEX "documents_person_id_idx" ON "documents"("person_id");

-- CreateIndex
CREATE INDEX "documents_valid_to_idx" ON "documents"("valid_to");

-- CreateIndex
CREATE INDEX "companies_ico_idx" ON "companies"("ico");

-- CreateIndex
CREATE INDEX "companies_type_idx" ON "companies"("type");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "orders_type_idx" ON "orders"("type");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_company_id_idx" ON "orders"("company_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "warehouse_locations_warehouse_id_idx" ON "warehouse_locations"("warehouse_id");

-- CreateIndex
CREATE INDEX "warehouse_locations_barcode_idx" ON "warehouse_locations"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "materials_code_key" ON "materials"("code");

-- CreateIndex
CREATE INDEX "materials_code_idx" ON "materials"("code");

-- CreateIndex
CREATE INDEX "materials_barcode_idx" ON "materials"("barcode");

-- CreateIndex
CREATE INDEX "materials_supplier_id_idx" ON "materials"("supplier_id");

-- CreateIndex
CREATE INDEX "materials_factorify_id_idx" ON "materials"("factorify_id");

-- CreateIndex
CREATE INDEX "inventory_movements_material_id_idx" ON "inventory_movements"("material_id");

-- CreateIndex
CREATE INDEX "inventory_movements_warehouse_id_idx" ON "inventory_movements"("warehouse_id");

-- CreateIndex
CREATE INDEX "inventory_movements_created_at_idx" ON "inventory_movements"("created_at");

-- CreateIndex
CREATE INDEX "inventory_items_inventory_id_idx" ON "inventory_items"("inventory_id");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_timestamp_idx" ON "audit_log"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "mindmap_notes_key_key" ON "mindmap_notes"("key");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE INDEX "products_factorify_id_idx" ON "products"("factorify_id");

-- CreateIndex
CREATE INDEX "workstations_factorify_id_idx" ON "workstations"("factorify_id");

-- CreateIndex
CREATE INDEX "product_operations_product_id_idx" ON "product_operations"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "assistants_slug_key" ON "assistants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "skills_slug_key" ON "skills"("slug");

-- CreateIndex
CREATE INDEX "conversations_user_id_idx" ON "conversations"("user_id");

-- CreateIndex
CREATE INDEX "conversations_assistant_id_idx" ON "conversations"("assistant_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_idx" ON "messages"("conversation_id");

-- CreateIndex
CREATE INDEX "skill_executions_skill_id_idx" ON "skill_executions"("skill_id");

-- CreateIndex
CREATE INDEX "skill_executions_created_at_idx" ON "skill_executions"("created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_parent_role_id_fkey" FOREIGN KEY ("parent_role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_notifications" ADD CONSTRAINT "document_notifications_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_notifications" ADD CONSTRAINT "document_notifications_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_rules" ADD CONSTRAINT "stock_rules_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_rules" ADD CONSTRAINT "stock_rules_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_rules" ADD CONSTRAINT "stock_rules_preferred_supplier_id_fkey" FOREIGN KEY ("preferred_supplier_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_counted_by_fkey" FOREIGN KEY ("counted_by") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_operations" ADD CONSTRAINT "product_operations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_operations" ADD CONSTRAINT "product_operations_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "workstations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_skills" ADD CONSTRAINT "assistant_skills_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_skills" ADD CONSTRAINT "assistant_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_executions" ADD CONSTRAINT "skill_executions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_executions" ADD CONSTRAINT "skill_executions_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
