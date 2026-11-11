-- Číslo verze uloženého stavu hry. Každé uložení ho zvedne o jedna, takže když
-- hráč hraje na dvou zařízeních, pozná se, že to druhé vychází ze starší verze
-- a nemá ji přepsat.
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "state_rev" INTEGER NOT NULL DEFAULT 0;
