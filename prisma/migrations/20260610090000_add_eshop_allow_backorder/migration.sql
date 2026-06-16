-- Spare Parts Shop — nabízet díl i bez skladu ("na objednávku")
ALTER TABLE "materials" ADD COLUMN "eshop_allow_backorder" BOOLEAN NOT NULL DEFAULT false;
