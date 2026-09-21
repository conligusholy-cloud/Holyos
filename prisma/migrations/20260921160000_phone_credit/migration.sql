-- =============================================================================
-- Kredit přiřazený telefonnímu číslu (Infolinka)
-- =============================================================================
-- Operátor přiřadí kredit číslu, které už na Infolinku volalo. Při dalším hovoru
-- z téhož čísla se kredit ukáže na obrazovce operátora (seznam hovorů v HolyOS
-- i mobilní přehled + banner „právě volá"). Párování je podle posledních 9 číslic
-- (phone_tail), ať je jedno, jestli číslo dorazí jako +420777123456 nebo 777123456.

CREATE TABLE IF NOT EXISTS "phone_credits" (
  "id"                 SERIAL PRIMARY KEY,
  "phone"              VARCHAR(40) NOT NULL,
  "phone_tail"         VARCHAR(16) NOT NULL,
  "amount"             DECIMAL(12, 2) NOT NULL,
  "currency"           VARCHAR(8) NOT NULL DEFAULT 'CZK',
  "note"               TEXT,
  "created_by_user_id" INTEGER,
  "updated_by_user_id" INTEGER,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Jedno číslo = jeden kredit (klíč pro párování s hovorem).
CREATE UNIQUE INDEX IF NOT EXISTS "phone_credits_phone_tail_key" ON "phone_credits"("phone_tail");
CREATE INDEX IF NOT EXISTS "phone_credits_phone_idx" ON "phone_credits"("phone");
