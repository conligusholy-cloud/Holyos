-- HolyOS — přidání protokolu / dodacího listu k záznamu výměny pneu.
-- Pole je volitelné, takže existující záznamy nepotřebují default a migrace
-- je bezpečná pro běžící DB. Idempotentní (IF NOT EXISTS).

ALTER TABLE "vehicle_tire_changes" ADD COLUMN IF NOT EXISTS "protocol_url" VARCHAR(500);
