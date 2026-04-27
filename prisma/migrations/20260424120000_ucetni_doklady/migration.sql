-- CreateTable
CREATE TABLE "invoices" (
    "id" SERIAL NOT NULL,
    "invoice_number" VARCHAR(50) NOT NULL,
    "external_number" VARCHAR(100),
    "type" VARCHAR(30) NOT NULL,
    "direction" VARCHAR(2) NOT NULL,
    "company_id" INTEGER NOT NULL,
    "order_id" INTEGER,
    "warehouse_document_id" INTEGER,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CZK',
    "exchange_rate" DECIMAL(12,6) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rounding" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_regime" VARCHAR(30) NOT NULL DEFAULT 'standard',
    "date_issued" DATE NOT NULL,
    "date_taxable" DATE,
    "date_received" TIMESTAMP(3),
    "date_due" DATE NOT NULL,
    "payment_method" VARCHAR(20) NOT NULL DEFAULT 'bank_transfer',
    "variable_symbol" VARCHAR(20),
    "constant_symbol" VARCHAR(10),
    "specific_symbol" VARCHAR(20),
    "partner_bank_account" VARCHAR(50),
    "partner_iban" VARCHAR(34),
    "partner_bic" VARCHAR(11),
    "status" VARCHAR(30) NOT NULL DEFAULT 'draft',
    "approved_by_id" INTEGER,
    "approved_at" TIMESTAMP(3),
    "reminder_1_sent_at" TIMESTAMP(3),
    "reminder_2_sent_at" TIMESTAMP(3),
    "reminder_3_sent_at" TIMESTAMP(3),
    "source" VARCHAR(30),
    "email_ingest_id" INTEGER,
    "ocr_confidence" DECIMAL(4,3),
    "ocr_passes_done" INTEGER NOT NULL DEFAULT 0,
    "needs_human_review" BOOLEAN NOT NULL DEFAULT false,
    "source_file_path" VARCHAR(500),
    "pdf_file_path" VARCHAR(500),
    "note" TEXT,
    "internal_note" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "line_order" INTEGER NOT NULL DEFAULT 0,
    "description" VARCHAR(500) NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unit" VARCHAR(20) NOT NULL DEFAULT 'ks',
    "unit_price" DECIMAL(14,4) NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 21,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "cost_center_id" INTEGER,
    "material_id" INTEGER,
    "product_id" INTEGER,
    "vehicle_id" INTEGER,
    "person_id" INTEGER,
    "order_item_id" INTEGER,
    "note" VARCHAR(500),

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_approval_steps" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "step_order" INTEGER NOT NULL,
    "approver_id" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "decided_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "parent_id" INTEGER,
    "vehicle_id" INTEGER,
    "person_id" INTEGER,
    "department_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_batches" (
    "id" SERIAL NOT NULL,
    "batch_number" VARCHAR(50) NOT NULL,
    "bank_account_id" INTEGER NOT NULL,
    "format" VARCHAR(30) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'draft',
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "file_path" VARCHAR(500),
    "generated_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "due_date" DATE NOT NULL,
    "note" TEXT,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" SERIAL NOT NULL,
    "direction" VARCHAR(3) NOT NULL,
    "method" VARCHAR(20) NOT NULL DEFAULT 'bank_transfer',
    "batch_id" INTEGER,
    "cash_register_id" INTEGER,
    "bank_transaction_id" INTEGER,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CZK',
    "amount_czk" DECIMAL(14,2) NOT NULL,
    "partner_name" VARCHAR(255) NOT NULL,
    "partner_account" VARCHAR(50),
    "variable_symbol" VARCHAR(20),
    "constant_symbol" VARCHAR(10),
    "specific_symbol" VARCHAR(20),
    "message" VARCHAR(140),
    "scheduled_date" DATE,
    "executed_date" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" SERIAL NOT NULL,
    "payment_id" INTEGER NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "bank" VARCHAR(20) NOT NULL,
    "account_number" VARCHAR(30) NOT NULL,
    "bank_code" VARCHAR(4) NOT NULL,
    "iban" VARCHAR(34),
    "bic" VARCHAR(11),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CZK',
    "api_enabled" BOOLEAN NOT NULL DEFAULT false,
    "api_credentials_ref" VARCHAR(255),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "opening_balance" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "current_balance" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "last_statement_date" DATE,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statements" (
    "id" SERIAL NOT NULL,
    "bank_account_id" INTEGER NOT NULL,
    "statement_number" VARCHAR(50) NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "opening_balance" DECIMAL(16,2) NOT NULL,
    "closing_balance" DECIMAL(16,2) NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "file_path" VARCHAR(500),
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_by_id" INTEGER,

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" SERIAL NOT NULL,
    "bank_account_id" INTEGER NOT NULL,
    "statement_id" INTEGER,
    "transaction_date" DATE NOT NULL,
    "value_date" DATE,
    "direction" VARCHAR(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CZK',
    "counterparty_name" VARCHAR(255),
    "counterparty_account" VARCHAR(50),
    "variable_symbol" VARCHAR(20),
    "constant_symbol" VARCHAR(10),
    "specific_symbol" VARCHAR(20),
    "message" VARCHAR(255),
    "reference" VARCHAR(100),
    "match_status" VARCHAR(20) NOT NULL DEFAULT 'unmatched',
    "match_method" VARCHAR(20),
    "match_rule_id" INTEGER,
    "note" TEXT,
    "resolved_by_id" INTEGER,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matching_rules" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "direction" VARCHAR(3),
    "counterparty_account" VARCHAR(50),
    "counterparty_name_contains" VARCHAR(255),
    "variable_symbol" VARCHAR(20),
    "amount_min" DECIMAL(14,2),
    "amount_max" DECIMAL(14,2),
    "action" VARCHAR(30) NOT NULL,
    "cost_center_id" INTEGER,
    "assignee_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matching_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_registers" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CZK',
    "location" VARCHAR(255),
    "responsible_id" INTEGER,
    "opening_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "current_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "last_reconciled_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" SERIAL NOT NULL,
    "cash_register_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "document_number" VARCHAR(30) NOT NULL,
    "direction" VARCHAR(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "purpose" VARCHAR(50) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "invoice_id" INTEGER,
    "cost_center_id" INTEGER,
    "receipt_file_path" VARCHAR(500),
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_ingests" (
    "id" SERIAL NOT NULL,
    "mailbox" VARCHAR(255) NOT NULL,
    "message_id" VARCHAR(255) NOT NULL,
    "thread_id" VARCHAR(255),
    "from_email" VARCHAR(255) NOT NULL,
    "from_name" VARCHAR(255),
    "to_email" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "body_text" TEXT,
    "body_html" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(30) NOT NULL DEFAULT 'received',
    "confidence" DECIMAL(4,3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sender_notified_at" TIMESTAMP(3),
    "sender_notify_reason" VARCHAR(255),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_ingests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_attachments" (
    "id" SERIAL NOT NULL,
    "email_ingest_id" INTEGER NOT NULL,
    "filename" VARCHAR(500) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "file_path" VARCHAR(500) NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'attachment',
    "source_url" VARCHAR(1000),
    "sha256" VARCHAR(64),
    "is_invoice_candidate" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr_extractions" (
    "id" SERIAL NOT NULL,
    "email_ingest_id" INTEGER,
    "attachment_id" INTEGER,
    "invoice_id" INTEGER,
    "pass_number" INTEGER NOT NULL,
    "pass_type" VARCHAR(50) NOT NULL,
    "model_used" VARCHAR(50),
    "extracted_data" JSONB NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "warnings" JSONB,
    "errors" JSONB,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_czk" DECIMAL(8,4),
    "executed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_ms" INTEGER,

    CONSTRAINT "ocr_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "sent_to_email" VARCHAR(255),
    "subject" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accountant_handovers" (
    "id" SERIAL NOT NULL,
    "period_month" INTEGER NOT NULL,
    "period_year" INTEGER NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'preparing',
    "document_count" INTEGER NOT NULL DEFAULT 0,
    "total_received" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_issued" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_cash" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "zip_file_path" VARCHAR(500),
    "checklist" JSONB NOT NULL,
    "sent_at" TIMESTAMP(3),
    "sent_to_email" VARCHAR(255),
    "confirmed_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accountant_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accountant_handover_items" (
    "id" SERIAL NOT NULL,
    "handover_id" INTEGER NOT NULL,
    "document_type" VARCHAR(30) NOT NULL,
    "document_id" INTEGER NOT NULL,
    "file_path" VARCHAR(500),
    "included" BOOLEAN NOT NULL DEFAULT true,
    "note" VARCHAR(500),
    "invoice_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accountant_handover_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "invoices_type_status_idx" ON "invoices"("type", "status");

-- CreateIndex
CREATE INDEX "invoices_direction_status_idx" ON "invoices"("direction", "status");

-- CreateIndex
CREATE INDEX "invoices_company_id_idx" ON "invoices"("company_id");

-- CreateIndex
CREATE INDEX "invoices_order_id_idx" ON "invoices"("order_id");

-- CreateIndex
CREATE INDEX "invoices_date_issued_idx" ON "invoices"("date_issued");

-- CreateIndex
CREATE INDEX "invoices_date_due_idx" ON "invoices"("date_due");

-- CreateIndex
CREATE INDEX "invoices_external_number_idx" ON "invoices"("external_number");

-- CreateIndex
CREATE INDEX "invoices_variable_symbol_idx" ON "invoices"("variable_symbol");

-- CreateIndex
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_items_cost_center_id_idx" ON "invoice_items"("cost_center_id");

-- CreateIndex
CREATE INDEX "invoice_items_vehicle_id_idx" ON "invoice_items"("vehicle_id");

-- CreateIndex
CREATE INDEX "invoice_items_person_id_idx" ON "invoice_items"("person_id");

-- CreateIndex
CREATE INDEX "invoice_items_material_id_idx" ON "invoice_items"("material_id");

-- CreateIndex
CREATE INDEX "invoice_approval_steps_invoice_id_idx" ON "invoice_approval_steps"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_approval_steps_approver_id_status_idx" ON "invoice_approval_steps"("approver_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_code_key" ON "cost_centers"("code");

-- CreateIndex
CREATE INDEX "cost_centers_type_active_idx" ON "cost_centers"("type", "active");

-- CreateIndex
CREATE INDEX "cost_centers_vehicle_id_idx" ON "cost_centers"("vehicle_id");

-- CreateIndex
CREATE INDEX "cost_centers_person_id_idx" ON "cost_centers"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_batches_batch_number_key" ON "payment_batches"("batch_number");

-- CreateIndex
CREATE INDEX "payment_batches_status_due_date_idx" ON "payment_batches"("status", "due_date");

-- CreateIndex
CREATE INDEX "payment_batches_bank_account_id_idx" ON "payment_batches"("bank_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_bank_transaction_id_key" ON "payments"("bank_transaction_id");

-- CreateIndex
CREATE INDEX "payments_status_scheduled_date_idx" ON "payments"("status", "scheduled_date");

-- CreateIndex
CREATE INDEX "payments_batch_id_idx" ON "payments"("batch_id");

-- CreateIndex
CREATE INDEX "payments_variable_symbol_idx" ON "payments"("variable_symbol");

-- CreateIndex
CREATE INDEX "payment_allocations_payment_id_idx" ON "payment_allocations"("payment_id");

-- CreateIndex
CREATE INDEX "payment_allocations_invoice_id_idx" ON "payment_allocations"("invoice_id");

-- CreateIndex
CREATE INDEX "bank_accounts_bank_active_idx" ON "bank_accounts"("bank", "active");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_account_number_bank_code_key" ON "bank_accounts"("account_number", "bank_code");

-- CreateIndex
CREATE INDEX "bank_statements_period_from_period_to_idx" ON "bank_statements"("period_from", "period_to");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statements_bank_account_id_statement_number_key" ON "bank_statements"("bank_account_id", "statement_number");

-- CreateIndex
CREATE INDEX "bank_transactions_transaction_date_idx" ON "bank_transactions"("transaction_date");

-- CreateIndex
CREATE INDEX "bank_transactions_match_status_idx" ON "bank_transactions"("match_status");

-- CreateIndex
CREATE INDEX "bank_transactions_variable_symbol_idx" ON "bank_transactions"("variable_symbol");

-- CreateIndex
CREATE INDEX "bank_transactions_counterparty_account_idx" ON "bank_transactions"("counterparty_account");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_bank_account_id_reference_key" ON "bank_transactions"("bank_account_id", "reference");

-- CreateIndex
CREATE INDEX "matching_rules_active_priority_idx" ON "matching_rules"("active", "priority");

-- CreateIndex
CREATE INDEX "cash_registers_active_idx" ON "cash_registers"("active");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_document_number_key" ON "cash_movements"("document_number");

-- CreateIndex
CREATE INDEX "cash_movements_cash_register_id_date_idx" ON "cash_movements"("cash_register_id", "date");

-- CreateIndex
CREATE INDEX "cash_movements_invoice_id_idx" ON "cash_movements"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_ingests_message_id_key" ON "email_ingests"("message_id");

-- CreateIndex
CREATE INDEX "email_ingests_status_received_at_idx" ON "email_ingests"("status", "received_at");

-- CreateIndex
CREATE INDEX "email_ingests_mailbox_idx" ON "email_ingests"("mailbox");

-- CreateIndex
CREATE INDEX "email_attachments_email_ingest_id_idx" ON "email_attachments"("email_ingest_id");

-- CreateIndex
CREATE INDEX "email_attachments_sha256_idx" ON "email_attachments"("sha256");

-- CreateIndex
CREATE INDEX "ocr_extractions_email_ingest_id_idx" ON "ocr_extractions"("email_ingest_id");

-- CreateIndex
CREATE INDEX "ocr_extractions_invoice_id_idx" ON "ocr_extractions"("invoice_id");

-- CreateIndex
CREATE INDEX "ocr_extractions_pass_type_idx" ON "ocr_extractions"("pass_type");

-- CreateIndex
CREATE INDEX "reminders_status_scheduled_at_idx" ON "reminders"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "reminders_invoice_id_level_key" ON "reminders"("invoice_id", "level");

-- CreateIndex
CREATE INDEX "accountant_handovers_status_idx" ON "accountant_handovers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "accountant_handovers_period_year_period_month_key" ON "accountant_handovers"("period_year", "period_month");

-- CreateIndex
CREATE INDEX "accountant_handover_items_handover_id_idx" ON "accountant_handover_items"("handover_id");

-- CreateIndex
CREATE INDEX "accountant_handover_items_document_type_document_id_idx" ON "accountant_handover_items"("document_type", "document_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_warehouse_document_id_fkey" FOREIGN KEY ("warehouse_document_id") REFERENCES "warehouse_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_email_ingest_id_fkey" FOREIGN KEY ("email_ingest_id") REFERENCES "email_ingests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_approval_steps" ADD CONSTRAINT "invoice_approval_steps_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_approval_steps" ADD CONSTRAINT "invoice_approval_steps_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_batches" ADD CONSTRAINT "payment_batches_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_batches" ADD CONSTRAINT "payment_batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payment_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bank_transaction_id_fkey" FOREIGN KEY ("bank_transaction_id") REFERENCES "bank_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "bank_statements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_match_rule_id_fkey" FOREIGN KEY ("match_rule_id") REFERENCES "matching_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_responsible_id_fkey" FOREIGN KEY ("responsible_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_email_ingest_id_fkey" FOREIGN KEY ("email_ingest_id") REFERENCES "email_ingests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_extractions" ADD CONSTRAINT "ocr_extractions_email_ingest_id_fkey" FOREIGN KEY ("email_ingest_id") REFERENCES "email_ingests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_extractions" ADD CONSTRAINT "ocr_extractions_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "email_attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_extractions" ADD CONSTRAINT "ocr_extractions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accountant_handover_items" ADD CONSTRAINT "accountant_handover_items_handover_id_fkey" FOREIGN KEY ("handover_id") REFERENCES "accountant_handovers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accountant_handover_items" ADD CONSTRAINT "accountant_handover_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

