-- HolyOS — Schvalování objednávek (Order approval workflow)
-- Účel: každá manuálně vytvořená Order projde schválením ředitele;
--       MRP-autogenerované Order dostanou rovnou auto_approved.
-- Faktura napojená na schválenou Order zobrazí ve výpisu sloupec "Schválil".

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "approval_status" VARCHAR(20) NOT NULL DEFAULT 'pending';
ALTER TABLE "orders" ADD COLUMN     "approved_by_user_id" INTEGER;
ALTER TABLE "orders" ADD COLUMN     "approved_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN     "approval_note" TEXT;
ALTER TABLE "orders" ADD COLUMN     "submitted_for_approval_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN     "source" VARCHAR(20) NOT NULL DEFAULT 'manual';

-- Backfill — existující objednávky historicky neprochází schvalováním;
-- označíme je jako auto_approved, ať se Tomášovi ráno neukáže 100 pendingů ke schválení.
UPDATE "orders" SET "approval_status" = 'auto_approved' WHERE "approval_status" = 'pending';

-- CreateIndex
CREATE INDEX "orders_approval_status_idx" ON "orders"("approval_status");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
