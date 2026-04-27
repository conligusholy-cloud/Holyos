-- Vozový park: přidání pole protocol_url na VehicleService
-- (úkol #26 — Protokol / dodací list ke každému servisu, PDF nebo obrázek)
--
-- Idempotentní — IF NOT EXISTS.

ALTER TABLE "vehicle_services" ADD COLUMN IF NOT EXISTS "protocol_url" VARCHAR(500);
