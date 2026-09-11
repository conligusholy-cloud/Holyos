-- Kdo měl v době hovoru službu a hovor na Infolince NIKDO nevyřídil (do hodnocení lidí).
ALTER TABLE "voice_calls" ADD COLUMN "unhandled_person_ids" JSONB;
