-- Evidence zpětných volání technika na kontakt (tlačítko „Zavolat zpět" v mobilním přehledu).
ALTER TABLE "voice_calls" ADD COLUMN "callback_log" JSONB;
