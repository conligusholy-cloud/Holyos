-- Evidence SMS s odkazem, kterou technik poslal volajícímu z vlastního telefonu.
ALTER TABLE "voice_calls" ADD COLUMN "manual_sms_log" JSONB;
