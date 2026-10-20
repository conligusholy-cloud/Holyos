-- Servisní smlouva: datum vystavení první faktury periody
ALTER TABLE "service_subscriptions" ADD COLUMN IF NOT EXISTS "first_invoice_date" DATE;
