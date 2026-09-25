-- Site: procesní pole podle Excelu „Tabulková verze míst"
ALTER TABLE "sites" ADD COLUMN "survey_done" BOOLEAN;
ALTER TABLE "sites" ADD COLUMN "preapproval_note" TEXT;
ALTER TABLE "sites" ADD COLUMN "contract_note" TEXT;
ALTER TABLE "sites" ADD COLUMN "building_permit_note" TEXT;
