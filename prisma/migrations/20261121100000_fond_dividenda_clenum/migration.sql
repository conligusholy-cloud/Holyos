-- Průběžná dividenda i pro členy fondu.
--
-- Akcionáři už dividendu nabíhající v čase mají; členové, kteří do fondu
-- složili peníze, dostali dosud jen to, co si jednorázově odhlasovali. Fond
-- si proto může nastavit druhou sazbu — kolik procent svého dílu na hodnotě
-- fondu dostanou členové za herní rok. Platí pro ni stejná pravidla:
-- jen z volných peněz, a když fond nemá, nenabíhá nic.
ALTER TABLE "game_aliance" ADD COLUMN IF NOT EXISTS "clen_sazba" DOUBLE PRECISION NOT NULL DEFAULT 0;
-- Díl členů na hodnotě fondu, dopočítaný při přecenění. Bez něj by se u
-- každé výplaty muselo znovu ocenit celé jmění všech firem, které fond drží.
ALTER TABLE "game_aliance" ADD COLUMN IF NOT EXISTS "clen_zaklad" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "game_fond_vklad" ADD COLUMN IF NOT EXISTS "dividenda_do" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "game_fond_vklad" SET "dividenda_do" = CURRENT_TIMESTAMP;
