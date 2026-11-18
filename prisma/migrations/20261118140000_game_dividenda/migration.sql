-- Dividendová politika firmy.
--
-- Doteď odcházel podílníkům každý měsíc celý jejich díl zisku a nedalo se
-- s tím nic dělat. Politika je první pravomoc, kterou většinový podílník
-- dostává: určuje, kolik procent zisku se vyplácí a kolik zůstane ve firmě.
--
-- Výchozí jedna = sto procent, tedy přesně to, jak se vyplácelo dosud.
-- Žádnému hráči se tím výplata nezmění, dokud ji někdo vědomě nepřestaví.
-- NOT NULL je tu schválně: null by přes Number(null) spadl na nulu a
-- potichu zastavil výplaty celé hře.
ALTER TABLE "game_players"
  ADD COLUMN IF NOT EXISTS "dividenda_pct" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- Kdo politiku naposledy nastavil a kdy. Je to cizí zásah do vlastní firmy,
-- takže majitel musí vidět, čí to byla ruka.
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "dividenda_kdo" INTEGER;
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "dividenda_at" TIMESTAMP(3);
