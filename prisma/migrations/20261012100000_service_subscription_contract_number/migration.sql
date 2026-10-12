-- Číslo servisní smlouvy u fakturace servisních smluv
ALTER TABLE "service_subscriptions" ADD COLUMN IF NOT EXISTS "contract_number" VARCHAR(80);
