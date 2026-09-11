-- Evidence přesměrování hovoru na živého kolegu
ALTER TABLE "voice_calls" ADD COLUMN IF NOT EXISTS "transfer_log" JSONB;
