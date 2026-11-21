-- Druh návrhu se nevešel do sloupce.
--
-- Sloupec byl VARCHAR(12) z doby, kdy nejdelší druh byl "dividenda". Pak
-- přibyly akcie a s nimi "akcie_dividenda" (15 znaků) a "akcie_sazba" (11).
-- Delší z nich se do sloupce nevešel a Postgres zápis odmítl — hráč zmáčkl
-- „Dát hlasovat" u dividendy akcionářům a dostal jen „Interní chyba serveru".
ALTER TABLE "game_fond_navrh" ALTER COLUMN "druh" TYPE VARCHAR(24);
