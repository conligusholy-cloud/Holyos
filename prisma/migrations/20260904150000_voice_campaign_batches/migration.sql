-- Kola/seznamy uvnitř kampaně (uzavřít seznam, začít nový; statistika per kolo)
ALTER TABLE "voice_campaigns" ADD COLUMN "current_batch" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "voice_campaign_targets" ADD COLUMN "batch_no" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "voice_campaign_targets_campaign_id_batch_no_idx" ON "voice_campaign_targets"("campaign_id", "batch_no");
