-- =============================================================================
-- Nárok na dovolenou — datum platnosti + hromadný přepočet k datu
-- =============================================================================
-- Person.leave_entitlement_from = „K DATU" v kartě zaměstnance (od kdy nárok platí).
-- LeaveSettings.effective_from  = datum, ke kterému se nárok přepočítá všem.
-- LeaveSettings.last_applied_from = kdy přepočet naposledy proběhl (ochrana
--                                   proti opakovanému spuštění).

ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "leave_entitlement_from" DATE;

ALTER TABLE "leave_settings" ADD COLUMN IF NOT EXISTS "effective_from" DATE;
ALTER TABLE "leave_settings" ADD COLUMN IF NOT EXISTS "last_applied_from" DATE;

-- Dosavadní pole `year` zůstává kvůli historickým datům; UI ho už nepoužívá.
-- Prvotní naplnění effective_from z roku, ať nastavení nezůstane bez data.
UPDATE "leave_settings"
   SET "effective_from" = make_date("year", 1, 1)
 WHERE "effective_from" IS NULL AND "year" IS NOT NULL;
