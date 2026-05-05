-- AlterTable: ProductOperation.is_staging — flag pro staging "FY import" operace,
-- které nejsou skutečné pracovní operace (jen migrační okno pro materiály k roztřídění).
ALTER TABLE "product_operations" ADD COLUMN "is_staging" BOOLEAN NOT NULL DEFAULT false;

-- Označ všechny existující "FY import" operace jako staging
UPDATE "product_operations" SET "is_staging" = true WHERE "name" ILIKE 'FY import%';

-- Index pro rychlý filtr (plánovač/simulace ignoruje is_staging=true)
CREATE INDEX "product_operations_is_staging_idx" ON "product_operations"("is_staging");
