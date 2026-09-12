-- Další volající k téže závadě (proti duplicitním servisním požadavkům)
ALTER TABLE "service_requests" ADD COLUMN IF NOT EXISTS "extra_callers" JSONB;
