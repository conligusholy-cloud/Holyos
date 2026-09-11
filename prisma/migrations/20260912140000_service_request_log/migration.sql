-- Log aktivit u servisního požadavku (audit trail: kdo, kdy, co udělal)
CREATE TABLE IF NOT EXISTS "service_request_logs" (
  "id" SERIAL NOT NULL,
  "request_id" INTEGER NOT NULL,
  "actor" VARCHAR(160),
  "action" VARCHAR(40) NOT NULL,
  "detail" TEXT,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_request_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "service_request_logs_request_id_idx" ON "service_request_logs"("request_id");
