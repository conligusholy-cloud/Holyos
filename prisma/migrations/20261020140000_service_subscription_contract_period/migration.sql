-- Servisní smlouva: začátek a konec účinnosti (první/poslední měsíc se fakturuje jen za skutečně běžící dny)
ALTER TABLE "service_subscriptions" ADD COLUMN IF NOT EXISTS "contract_start" DATE;
ALTER TABLE "service_subscriptions" ADD COLUMN IF NOT EXISTS "contract_end" DATE;
