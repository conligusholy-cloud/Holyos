-- Klíč nákupu od klienta. Hlášení nákupu se nově opakuje, dokud ho server
-- nepotvrdí, a bez tohohle klíče by každé opakování založilo další stroj —
-- tedy přesně opačná chyba než ta, kterou spravujeme.
ALTER TABLE "game_orders" ADD COLUMN IF NOT EXISTS "klic" VARCHAR(48);
CREATE UNIQUE INDEX IF NOT EXISTS "game_orders_klic_key" ON "game_orders"("klic");
