-- Evidence SMS odeslaných během hovoru (např. odkaz na formulář přes GoSMS)
ALTER TABLE "voice_calls" ADD COLUMN IF NOT EXISTS "sms_log" JSONB;
