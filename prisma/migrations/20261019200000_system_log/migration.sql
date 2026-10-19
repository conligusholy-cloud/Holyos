-- Systémový log technických událostí (healthcheck napojení FB Lead Ads apod.)
CREATE TABLE IF NOT EXISTS "system_logs" (
    "id" SERIAL NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "system_logs_type_created_at_idx" ON "system_logs"("type", "created_at");
