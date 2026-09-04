-- Log odeslaných SMS (jednotný přehled se stavem doručení)
CREATE TABLE "sms_log" (
  "id" SERIAL NOT NULL,
  "provider" VARCHAR(20) NOT NULL,
  "to_number" VARCHAR(40) NOT NULL,
  "body" TEXT,
  "message_id" VARCHAR(64),
  "context" VARCHAR(40),
  "lead_id" INTEGER,
  "status" VARCHAR(20) NOT NULL DEFAULT 'sent',
  "delivered" BOOLEAN NOT NULL DEFAULT false,
  "error" TEXT,
  "status_checked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sms_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sms_log_created_at_idx" ON "sms_log"("created_at");
CREATE INDEX "sms_log_message_id_idx" ON "sms_log"("message_id");
CREATE INDEX "sms_log_lead_id_idx" ON "sms_log"("lead_id");
