-- IT požadavky: checklist pro zákazníka (vyplnit do 3 dnů)
CREATE TABLE IF NOT EXISTS "order_it_requests" (
  "id" SERIAL NOT NULL,
  "order_id" INTEGER NOT NULL,
  "token" VARCHAR(64) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'sent',
  "items" JSONB NOT NULL,
  "answers" JSONB,
  "customer_email" VARCHAR(255),
  "filled_by" VARCHAR(255),
  "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "due_at" TIMESTAMP(3) NOT NULL,
  "filled_at" TIMESTAMP(3),
  "reminder_sent_at" TIMESTAMP(3),
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_it_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "order_it_requests_token_key" ON "order_it_requests"("token");
CREATE INDEX IF NOT EXISTS "order_it_requests_order_id_idx" ON "order_it_requests"("order_id");
CREATE INDEX IF NOT EXISTS "order_it_requests_status_due_at_idx" ON "order_it_requests"("status", "due_at");
