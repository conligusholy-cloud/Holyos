-- Compounder Portal: per-účet sledování detailní ekonomiky
-- created_by se zneplatní (lead-generovaní příjemci nemají User),
-- přibývá vazba na CompounderLead.id.

ALTER TABLE "business_tool_recipients" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "business_tool_recipients" ADD COLUMN "compounder_lead_id" INTEGER;
CREATE INDEX "business_tool_recipients_compounder_lead_id_idx" ON "business_tool_recipients"("compounder_lead_id");
