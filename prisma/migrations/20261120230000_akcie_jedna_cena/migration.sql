-- Akcie fondu: jedna platná cena místo pořadníku nabídek.
--
-- Pořadník nechával cenu psát každého kupujícího zvlášť, takže v knize mohla
-- ležet nabídka za deset korun vedle nabídky za sto tisíc. Vypadalo to divně,
-- protože to divné bylo: cenu akcie si nemá určovat ten, kdo ji kupuje.
--
-- Nově je jedna cena. Při vydání ji určí fond hlasováním, pak s ní hýbe jen
-- obchodování: nákup nahoru, prodej dolů, tím víc, čím větší kus naráz.
-- Protistranou je vždycky fond — prodává ze svých nevydaných kusů a vykupuje
-- zpátky z pokladny.
ALTER TABLE "game_aliance" ADD COLUMN IF NOT EXISTS "akcie_celkem" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "game_aliance" ADD COLUMN IF NOT EXISTS "akcie_cena" INTEGER NOT NULL DEFAULT 0;

-- Kolik akcií vůbec existuje: co už drží hráči, plus co fondu zbylo
-- nevydaného v pořadníku. U EX ALTO to dává 15 + 985 = 1000.
UPDATE "game_aliance" a SET "akcie_celkem" = GREATEST(
  COALESCE(a."akcie_vydano", 0),
  COALESCE(a."akcie_vydano", 0) + COALESCE((
    SELECT SUM(n."zbyva") FROM "game_akcie_nabidka" n
     WHERE n."aliance_id" = a."id" AND n."stav" = 'bezi'
       AND n."smer" = 'prodat' AND n."player_id" = 0), 0))
 WHERE COALESCE(a."akcie_vydano", 0) > 0
    OR EXISTS (SELECT 1 FROM "game_akcie_nabidka" n WHERE n."aliance_id" = a."id");

-- Platná cena je poslední obchod, který se doopravdy stal. Když se ještě
-- neobchodovalo, bere se vyvolávací cena z nevydané nabídky fondu.
UPDATE "game_aliance" a SET "akcie_cena" = COALESCE((
    SELECT o."cena" FROM "game_akcie_obchod" o
     WHERE o."aliance_id" = a."id" ORDER BY o."kdy" DESC LIMIT 1
  ), (
    SELECT n."cena" FROM "game_akcie_nabidka" n
     WHERE n."aliance_id" = a."id" AND n."stav" = 'bezi'
       AND n."smer" = 'prodat' AND n."player_id" = 0 ORDER BY n."id" DESC LIMIT 1
  ), 0)
 WHERE a."akcie_celkem" > 0;

-- Pořadník už nemá kdo číst. Nic se tím neztrácí: nevydané kusy jsou teď
-- v akcie_celkem, vyvolávací cena v akcie_cena a uzavřené obchody mají
-- vlastní tabulku, ze které se kreslí graf. Dvě nabídky hráčů, které v něm
-- ležely (10 a 100 L$ za kus), zanikají — přesně o ně v té změně šlo.
DROP TABLE IF EXISTS "game_akcie_nabidka";
