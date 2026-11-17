-- Značka, že řádek nevznikl nákupem, ale dopočtem ze stavu hry.
-- Stroje koupené dřív, než se nákup začal zapisovat, server nezná. Dokud je
-- nedoplníme, sklad serveru a hry se nikdy nesrovná a nejde ze skladu udělat
-- podmínku stavby. Doplněné řádky se ale musí dát odlišit od pozorovaných:
-- u nich víme, že se opravdu kupovalo, u doplněných jen to, co tvrdí hra.
ALTER TABLE "game_orders" ADD COLUMN IF NOT EXISTS "doplneno" BOOLEAN NOT NULL DEFAULT false;
