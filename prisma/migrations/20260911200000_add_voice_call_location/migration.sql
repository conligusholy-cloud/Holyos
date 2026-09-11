-- Lokalita prádlomatu z hovoru (obchod + město), vytažená z AI shrnutí (bezplatný Twilio přepis).
ALTER TABLE "voice_calls" ADD COLUMN "location" VARCHAR(255);
