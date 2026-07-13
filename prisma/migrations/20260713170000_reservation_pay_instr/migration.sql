-- Pokyny k platbě: tracking odeslání na rezervaci (počet + poslední datum).
ALTER TABLE "location_reservations" ADD COLUMN IF NOT EXISTS "pay_instr_sent_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "location_reservations" ADD COLUMN IF NOT EXISTS "pay_instr_last_sent_at" TIMESTAMP(3);
