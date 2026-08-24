-- Hlasový AI agent — příchozí hovory (Twilio ConversationRelay)

-- Person: pole pro recepční na zmeškané hovory
ALTER TABLE "people" ADD COLUMN "voice_agent_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "people" ADD COLUMN "voice_twilio_number" VARCHAR(32);
ALTER TABLE "people" ADD COLUMN "voice_quiet_from" VARCHAR(5);
ALTER TABLE "people" ADD COLUMN "voice_quiet_to" VARCHAR(5);

-- Nová tabulka voice_calls
CREATE TABLE "voice_calls" (
    "id" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'inbound',
    "agent_kind" TEXT NOT NULL DEFAULT 'personal',
    "owner_person_id" INTEGER,
    "from_number" VARCHAR(32) NOT NULL,
    "to_number" VARCHAR(32) NOT NULL,
    "twilio_call_sid" VARCHAR(64) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "duration_sec" INTEGER,
    "transcript" JSONB,
    "summary" TEXT,
    "caller_name" VARCHAR(255),
    "caller_intent" TEXT,
    "audio_url" TEXT,
    "lead_id" TEXT,
    "sales_event_id" INTEGER,
    "handoff" BOOLEAN NOT NULL DEFAULT false,
    "cost_usd" DECIMAL(10,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "voice_calls_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "voice_calls_twilio_call_sid_key" ON "voice_calls"("twilio_call_sid");
CREATE INDEX "voice_calls_owner_person_id_idx" ON "voice_calls"("owner_person_id");
CREATE INDEX "voice_calls_from_number_idx" ON "voice_calls"("from_number");
CREATE INDEX "voice_calls_started_at_idx" ON "voice_calls"("started_at");

ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_owner_person_id_fkey" FOREIGN KEY ("owner_person_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
