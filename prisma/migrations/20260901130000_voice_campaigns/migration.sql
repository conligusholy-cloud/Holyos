-- Odchozí obvolávání leadů — kampaně + cíle

ALTER TABLE "voice_calls" ADD COLUMN "campaign_target_id" TEXT;

CREATE TABLE "voice_campaigns" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "script" TEXT,
    "from_number" VARCHAR(32),
    "max_attempts" INTEGER NOT NULL DEFAULT 1,
    "call_from" VARCHAR(5),
    "call_to" VARCHAR(5),
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "voice_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "voice_campaigns_status_idx" ON "voice_campaigns"("status");

CREATE TABLE "voice_campaign_targets" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "name" VARCHAR(255),
    "phone" VARCHAR(32) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_call_sid" VARCHAR(64),
    "result_summary" TEXT,
    "voice_call_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "voice_campaign_targets_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "voice_campaign_targets_campaign_id_idx" ON "voice_campaign_targets"("campaign_id");
CREATE INDEX "voice_campaign_targets_status_idx" ON "voice_campaign_targets"("status");

ALTER TABLE "voice_campaign_targets" ADD CONSTRAINT "voice_campaign_targets_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "voice_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
