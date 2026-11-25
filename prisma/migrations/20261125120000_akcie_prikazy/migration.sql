-- Kniha příkazů na burze akcií.
--
-- Fond akcie upíše a tím skončí; dál se obchodují mezi hráči. Příkaz je
-- limitní: „koupím tolik kusů nejvýš za tolik" nebo „prodám tolik nejméně
-- za tolik". Co se nespáruje hned, zůstane v knize ležet, dokud to někdo
-- nevezme nebo dokud to hráč nezruší.
--
-- pocet je ZBYTEK k vyřízení, pocet_pvodni to, co hráč zadal. Částečně
-- splněný příkaz tak jde pořád poznat od celého.
CREATE TABLE "game_akcie_prikaz" (
  "id"           SERIAL PRIMARY KEY,
  "aliance_id"   INTEGER NOT NULL,
  "player_id"    INTEGER NOT NULL,
  -- koupit | prodat
  "smer"         VARCHAR(8) NOT NULL,
  "pocet"        INTEGER NOT NULL,
  "pocet_pvodni" INTEGER NOT NULL,
  "cena"         INTEGER NOT NULL,
  -- bezi | splneno | zruseno
  "stav"         VARCHAR(10) NOT NULL DEFAULT 'bezi',
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Párování čte knihu jednoho fondu po jedné straně, seřazenou podle ceny
-- a stáří. Tenhle index je přesně to pořadí.
CREATE INDEX "game_akcie_prikaz_kniha" ON "game_akcie_prikaz"("aliance_id", "stav", "smer", "cena", "created_at");
-- Rezervace peněz se ptá, co má hráč rozjetého napříč všemi fondy.
CREATE INDEX "game_akcie_prikaz_hrac" ON "game_akcie_prikaz"("player_id", "stav");
