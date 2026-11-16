-- Doručenky: text jako kód a údaje místo hotové české věty, ať se složí
-- v jazyce toho, kdo ji čte. Starý sloupec popis zůstává pro stávající řádky.
ALTER TABLE "game_deliveries" ADD COLUMN IF NOT EXISTS "text_kod"  VARCHAR(60);
ALTER TABLE "game_deliveries" ADD COLUMN IF NOT EXISTS "text_data" JSONB;
