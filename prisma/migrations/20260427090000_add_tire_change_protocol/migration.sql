-- HolyOS — přidání protokolu / dodacího listu k záznamu výměny pneu.
-- Pole je volitelné, takže existující záznamy nepotřebují default a migrace
-- je bezpečná pro běžící DB.

ALTER TABLE "vehicle_tire_changes" ADD COLUMN "protocol_url" VARCHAR(500);
