-- Přidání výrobního čísla na položku objednávky (OrderItem)
-- Každý kus (každý řádek objednávky = 1 kiosek) může mít vlastní výrobní číslo.
-- Výrobní číslo je pak viditelné i ve výrobních slotech přes relaci order_item.
--
-- Migrace je psaná idempotentně — může se opakovaně aplikovat i po částečném běhu
-- (typicky když první pokus o prisma db execute selhal po první větě).

-- ─── OrderItem: výrobní číslo kiosku ──────────────────────────────────────
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "serial_number" VARCHAR(100);
CREATE INDEX IF NOT EXISTS "order_items_serial_number_idx" ON "order_items"("serial_number");

-- ─── SlotAssignment: explicitní FK na order_item (pro include relace) ────
-- Původní sloupec order_item_id byl jen Int?, bez FK. Nyní přidáváme
-- proper relační klíč, aby šlo v Prisma include natáhnout order_item.

-- Nejprve vyčistíme případné osiřelé odkazy (references na order_items, které už neexistují),
-- jinak by ADD CONSTRAINT s FK selhal na validaci.
UPDATE "slot_assignments" SET "order_item_id" = NULL
WHERE "order_item_id" IS NOT NULL
  AND "order_item_id" NOT IN (SELECT "id" FROM "order_items");

CREATE INDEX IF NOT EXISTS "slot_assignments_order_item_id_idx" ON "slot_assignments"("order_item_id");

-- FK constraint — přidej jen pokud ještě neexistuje (Postgres nemá "ADD CONSTRAINT IF NOT EXISTS")
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'slot_assignments_order_item_id_fkey'
      AND conrelid = '"slot_assignments"'::regclass
  ) THEN
    ALTER TABLE "slot_assignments"
      ADD CONSTRAINT "slot_assignments_order_item_id_fkey"
      FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;
