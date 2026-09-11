-- Celý přepis nahrávky hovoru (vč. části zákazník–technik) přes OpenAI Whisper.
ALTER TABLE "voice_calls" ADD COLUMN "full_transcript" TEXT;
ALTER TABLE "voice_calls" ADD COLUMN "full_transcript_at" TIMESTAMP(3);
