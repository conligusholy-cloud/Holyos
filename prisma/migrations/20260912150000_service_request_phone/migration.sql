-- Telefon volajícího na servisním požadavku — pro přesné párování s hovorem Infolinky
ALTER TABLE "service_requests" ADD COLUMN IF NOT EXISTS "phone" VARCHAR(40);
