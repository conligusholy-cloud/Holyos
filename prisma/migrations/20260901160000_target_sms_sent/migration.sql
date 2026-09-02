-- Příznak, že leadovi už odešla SMS po nedovolání (aby se neposílala opakovaně)
ALTER TABLE "voice_campaign_targets" ADD COLUMN "sms_sent" BOOLEAN NOT NULL DEFAULT false;
