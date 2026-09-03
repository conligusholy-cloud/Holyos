-- Kanál odeslání SMS s odkazem na specialistu: gateway (GoSMS/Twilio) nebo phone (telefon obchodníka)
ALTER TABLE "compounder_leads" ADD COLUMN "ai_specialist_sms_channel" TEXT;
