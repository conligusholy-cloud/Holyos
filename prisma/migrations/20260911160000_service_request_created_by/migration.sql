-- Kdo servisní požadavek zadal (přihlášený uživatel) — pro mobilní formulář za loginem.
ALTER TABLE "service_requests" ADD COLUMN "created_by_user_id" INTEGER;
CREATE INDEX "service_requests_created_by_user_id_idx" ON "service_requests"("created_by_user_id");
