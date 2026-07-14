-- Nabídky lokalit z veřejného webu bestseries.global
-- Rozšíření modelu Site o zdroj veřejné nabídky a půdorys prádlomatu na mapě.

ALTER TABLE "sites" ADD COLUMN "public_source" VARCHAR(60);
ALTER TABLE "sites" ADD COLUMN "footprint_rotation" DECIMAL(6,2);
ALTER TABLE "sites" ADD COLUMN "footprint_w_mm" INTEGER DEFAULT 3182;
ALTER TABLE "sites" ADD COLUMN "footprint_h_mm" INTEGER DEFAULT 2015;

CREATE INDEX "sites_public_source_idx" ON "sites"("public_source");
