-- Dividenda z akcií, která nabíhá plynule.
--
-- Dosud mohl fond vyhlásit jednorázovou dividendu hlasováním a tím to končilo.
-- Kdo akcii koupil, neviděl z ní nic, dokud se členové na něčem neshodli.
-- Nově si fond odhlasuje SAZBU — kolik procent účetní hodnoty akcie vyplácí za
-- herní rok — a ta pak nabíhá každou sekundu. Akcionář to vidí hned.
--
-- Dvě meze, které z toho dělají slib, a ne díru do pokladny:
--   • platí se jen z VOLNÝCH peněz fondu (co je slíbené v nabídkách, se nerozdá),
--   • když fond nemá, dividenda nenabíhá — žádný skrytý dluh členům nad hlavou.
ALTER TABLE "game_aliance" ADD COLUMN IF NOT EXISTS "akcie_sazba" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Dokdy je u koho dividenda vyplacená. Běží od téhle chvíle, ne od vzniku
-- řádku: jinak by se prvnímu akcionáři vyplatilo zpětně všechno od chvíle,
-- kdy akcie koupil, i když tehdy žádná sazba neplatila.
ALTER TABLE "game_akcie" ADD COLUMN IF NOT EXISTS "dividenda_do" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "game_akcie" SET "dividenda_do" = CURRENT_TIMESTAMP;
