-- Reklamace praní: žádosti o vrácení platby a o zaslání dokladu (pradlomaty.info/podpora)
CREATE TABLE IF NOT EXISTS "wash_complaints" (
    "id" SERIAL NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'new',
    "tx_at" TIMESTAMP(3) NOT NULL,
    "place_code" VARCHAR(40),
    "place_label" VARCHAR(200) NOT NULL,
    "place_address" VARCHAR(300),
    "customer_name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(40) NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "pay_method" VARCHAR(40) NOT NULL,
    "service" VARCHAR(80) NOT NULL,
    "account" VARCHAR(60),
    "reason" TEXT,
    "internal_note" TEXT,
    "reject_reason" TEXT,
    "receipt_number" VARCHAR(30),
    "receipt_sent_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "resolved_by" VARCHAR(120),
    "resolved_at" TIMESTAMP(3),
    "history" JSONB,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "wash_complaints_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "wash_complaints_number_key" ON "wash_complaints"("number");
CREATE INDEX IF NOT EXISTS "wash_complaints_kind_status_idx" ON "wash_complaints"("kind", "status");
CREATE INDEX IF NOT EXISTS "wash_complaints_created_at_idx" ON "wash_complaints"("created_at");
CREATE INDEX IF NOT EXISTS "wash_complaints_email_idx" ON "wash_complaints"("email");
