-- Doplatky za změnu počtu uprostřed období se ruší: kdo si přikoupí technika,
-- má ho hned a zaplatí za něj až od dalšího období. Tím se ale rozchází to,
-- co se bude účtovat, a to, co hráč právě teď dostává — a je potřeba si
-- pamatovat obojí.
--
-- qty je nově POČET, KTERÝ SE BUDE ÚČTOVAT při nejbližší platbě.
-- qty_zaplaceno je počet, za který už hráč zaplatil běžící období; do konce
-- toho období mu patří, i kdyby mezitím ubral. Prázdná hodnota u starších
-- řádků znamená „stejně jako qty".
ALTER TABLE "game_subscriptions" ADD COLUMN IF NOT EXISTS "qty_zaplaceno" INTEGER;
