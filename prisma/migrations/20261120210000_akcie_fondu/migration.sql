-- Akcie fondu. Fond může vydat akcie a prodat tím kus sebe komukoli; akcionář
-- nemusí být člen a o chování fondu nehlasuje — rozhodují dál jen členové
-- podle vkladů. Co akcionář má: díl na hodnotě fondu a nárok na vyhlášenou
-- dividendu.
--
-- Dva sloupce u fondu nesou celý stav vydání:
--   akcie_vydano  kolik kusů je venku
--   akcie_podil   jaký díl fondu akcionáři dohromady drží (0 až 0,9)
-- Členům zbývá zbytek. Oboje se posouvá jen vydáním a počítá se z ceny
-- a počtu kusů, o kterých hlasovali členové — viz services/game/akcie.js.
ALTER TABLE "game_aliance" ADD COLUMN IF NOT EXISTS "akcie_vydano" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "game_aliance" ADD COLUMN IF NOT EXISTS "akcie_podil" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Kdo kolik akcií drží. Jeden řádek na dvojici fond–držitel; nula se maže,
-- aby se v knize nehromadili lidé, kteří všechno prodali.
CREATE TABLE IF NOT EXISTS "game_akcie" (
  "id"         SERIAL PRIMARY KEY,
  "aliance_id" INTEGER NOT NULL,
  "player_id"  INTEGER NOT NULL,
  "pocet"      INTEGER NOT NULL DEFAULT 0,
  -- Za kolik to dohromady koupil. Slouží jen k tomu, aby hráč viděl, jestli
  -- na akciích vydělal — na nic se podle toho nerozhoduje.
  "porizovaci" BIGINT  NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "game_akcie_fond_hrac" ON "game_akcie"("aliance_id", "player_id");
CREATE INDEX IF NOT EXISTS "game_akcie_player_id_idx" ON "game_akcie"("player_id");
ALTER TABLE "game_akcie" DROP CONSTRAINT IF EXISTS "game_akcie_pocet_nezaporny";
ALTER TABLE "game_akcie" ADD CONSTRAINT "game_akcie_pocet_nezaporny" CHECK ("pocet" >= 0);

-- Pořadník nabídek. Kdo chce koupit, řekne počet a nejvyšší cenu; kdo prodat,
-- počet a nejnižší. Co se potká, to se zobchoduje. `zbyva` je, kolik kusů
-- z nabídky ještě leží — částečné plnění je normální stav, ne výjimka.
CREATE TABLE IF NOT EXISTS "game_akcie_nabidka" (
  "id"         SERIAL PRIMARY KEY,
  "aliance_id" INTEGER NOT NULL,
  "player_id"  INTEGER NOT NULL,
  "nick"       VARCHAR(24) NOT NULL,
  "smer"       VARCHAR(8)  NOT NULL,
  "pocet"      INTEGER NOT NULL,
  "zbyva"      INTEGER NOT NULL,
  "cena"       INTEGER NOT NULL,
  "stav"       VARCHAR(12) NOT NULL DEFAULT 'bezi',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uzavreno_at" TIMESTAMP(3)
);
-- Kniha se čte vždycky po jednom fondu a jen to, co běží.
CREATE INDEX IF NOT EXISTS "game_akcie_nabidka_kniha"
  ON "game_akcie_nabidka"("aliance_id", "stav", "smer", "cena", "id");
CREATE INDEX IF NOT EXISTS "game_akcie_nabidka_player_id_idx" ON "game_akcie_nabidka"("player_id");
ALTER TABLE "game_akcie_nabidka" DROP CONSTRAINT IF EXISTS "game_akcie_nabidka_smer";
ALTER TABLE "game_akcie_nabidka" ADD CONSTRAINT "game_akcie_nabidka_smer"
  CHECK ("smer" IN ('koupit', 'prodat'));
-- Nabídka nesmí slíbit víc, než kolik jí zbývá, ani záporně.
ALTER TABLE "game_akcie_nabidka" DROP CONSTRAINT IF EXISTS "game_akcie_nabidka_zbyva";
ALTER TABLE "game_akcie_nabidka" ADD CONSTRAINT "game_akcie_nabidka_zbyva"
  CHECK ("zbyva" >= 0 AND "zbyva" <= "pocet");
ALTER TABLE "game_akcie_nabidka" DROP CONSTRAINT IF EXISTS "game_akcie_nabidka_cena";
ALTER TABLE "game_akcie_nabidka" ADD CONSTRAINT "game_akcie_nabidka_cena" CHECK ("cena" >= 1);

-- Uzavřené obchody. Z nich se kreslí graf ceny — cena akcie není nic jiného
-- než poslední obchod, který se doopravdy stal. Vydání se zapisuje taky,
-- s prodavajici_id prázdným: akcie tehdy vznikly, nikdo je neprodal.
CREATE TABLE IF NOT EXISTS "game_akcie_obchod" (
  "id"             SERIAL PRIMARY KEY,
  "aliance_id"     INTEGER NOT NULL,
  "kupujici_id"    INTEGER NOT NULL,
  "prodavajici_id" INTEGER,
  "pocet"          INTEGER NOT NULL,
  "cena"           INTEGER NOT NULL,
  "kdy"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "game_akcie_obchod_graf" ON "game_akcie_obchod"("aliance_id", "kdy");
CREATE INDEX IF NOT EXISTS "game_akcie_obchod_kupujici_idx" ON "game_akcie_obchod"("kupujici_id");
