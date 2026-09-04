-- Přepojení na živého člověka — nastavitelné per kampaň
ALTER TABLE "voice_campaigns"
  ADD COLUMN "transfer_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "transfer_fallback_numbers" TEXT,
  ADD COLUMN "transfer_ring_timeout" INTEGER;
