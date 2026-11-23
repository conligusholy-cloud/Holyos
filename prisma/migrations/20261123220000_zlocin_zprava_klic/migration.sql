-- Zprávy o zločinu v jazyce čtenáře.
--
-- Do novin se dosud ukládala hotová česká věta. Noviny ale čte každý hráč,
-- i ten, co hraje italsky — a u řádku, který v databázi už leží, se s tím
-- zpětně nedá dělat nic. Nově se ukládá kód zprávy a údaje k ní a věta se
-- skládá až u čtenáře. Sloupce nadpis/text se plní dál: jsou zálohou pro
-- starší řádky a pro případ, že by klíč v katalogu chyběl.
ALTER TABLE "game_zlocin_zpravy" ADD COLUMN "text_kod" VARCHAR(60);
ALTER TABLE "game_zlocin_zpravy" ADD COLUMN "text_data" JSONB;
