-- Servisní požadavky (agenda v modulu Servis)
CREATE TABLE IF NOT EXISTS "service_requests" (
  "id" SERIAL PRIMARY KEY,
  "problem" VARCHAR(255) NOT NULL,
  "action" VARCHAR(255),
  "task" VARCHAR(255),
  "description" TEXT,
  "photo_url" VARCHAR(500),
  "ordered_by" VARCHAR(120) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'novy',
  "assignee_id" INTEGER,
  "resolution" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "service_requests_status_idx" ON "service_requests"("status");
CREATE INDEX IF NOT EXISTS "service_requests_assignee_id_idx" ON "service_requests"("assignee_id");
