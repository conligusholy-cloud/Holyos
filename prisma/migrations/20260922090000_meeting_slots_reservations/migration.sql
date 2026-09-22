-- Termíny schůzek + rezervace (pradlomaty.info „cesta k rozhodnutí")
CREATE TABLE IF NOT EXISTS "meeting_slots" (
  "id" SERIAL PRIMARY KEY,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "duration_min" INTEGER NOT NULL DEFAULT 17,
  "capacity" INTEGER NOT NULL DEFAULT 1,
  "mode" VARCHAR(20),
  "note" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_person_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "meeting_slots_starts_at_idx" ON "meeting_slots"("starts_at");
CREATE INDEX IF NOT EXISTS "meeting_slots_active_idx" ON "meeting_slots"("active");

CREATE TABLE IF NOT EXISTS "meeting_reservations" (
  "id" SERIAL PRIMARY KEY,
  "slot_id" INTEGER NOT NULL,
  "compounder_lead_id" INTEGER,
  "name" VARCHAR(255),
  "email" VARCHAR(255),
  "phone" VARCHAR(60),
  "status" VARCHAR(20) NOT NULL DEFAULT 'booked',
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "meeting_reservations_slot_id_idx" ON "meeting_reservations"("slot_id");
CREATE INDEX IF NOT EXISTS "meeting_reservations_compounder_lead_id_idx" ON "meeting_reservations"("compounder_lead_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'meeting_reservations_slot_id_fkey' AND table_name = 'meeting_reservations'
  ) THEN
    ALTER TABLE "meeting_reservations"
      ADD CONSTRAINT "meeting_reservations_slot_id_fkey"
      FOREIGN KEY ("slot_id") REFERENCES "meeting_slots"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Pole na leadu pro variantu oslovení „schůzka" + pojistku proti dvojímu oslovení
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "outreach_variant" VARCHAR(20);
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "schuzka_sms_sent_at" TIMESTAMP(3);
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "schuzka_sms_id" TEXT;
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "schuzka_sms_status" TEXT;
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "schuzka_sms_channel" TEXT;
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "schuzka_opened_at" TIMESTAMP(3);
