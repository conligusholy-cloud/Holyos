-- Sběr identifikačních údajů kupujícího u rezervace (veřejný odkaz + poznámka)
ALTER TABLE "location_reservations"
  ADD COLUMN "details_token" VARCHAR(64),
  ADD COLUMN "details_expires_at" TIMESTAMP(3),
  ADD COLUMN "details_filled_at" TIMESTAMP(3),
  ADD COLUMN "note" TEXT;

CREATE UNIQUE INDEX "location_reservations_details_token_key" ON "location_reservations"("details_token");
