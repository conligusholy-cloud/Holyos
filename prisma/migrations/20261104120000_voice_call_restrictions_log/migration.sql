-- Technický log omezení provozu u hovoru: jakou lokalitu AI identifikovala,
-- co HolyOS načetl a co AI skutečně dostala (požadavek #130).
ALTER TABLE "voice_calls" ADD COLUMN IF NOT EXISTS "restrictions_log" JSONB;
