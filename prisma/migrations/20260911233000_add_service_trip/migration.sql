-- Fotodokumentace opravy u servisního požadavku.
ALTER TABLE "service_requests" ADD COLUMN "fix_photo_urls" JSONB;

-- Cesta servisáka k zásahu (logování ujetých km, odkud/kam).
CREATE TABLE "service_trips" (
  "id" SERIAL NOT NULL,
  "request_id" INTEGER NOT NULL,
  "person_id" INTEGER,
  "origin" VARCHAR(255) NOT NULL,
  "destination" VARCHAR(255) NOT NULL,
  "km" DECIMAL(8,1),
  "note" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_trips_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "service_trips_request_id_idx" ON "service_trips"("request_id");
CREATE INDEX "service_trips_person_id_idx" ON "service_trips"("person_id");
