-- Anti-podvod whitelist bankovních účtů na úrovni firmy.
-- JSON pole, defaultně prázdné, naplní se při schválení faktury / kliku "Potvrdit účet".
-- Schema mapuje model Company na tabulku "companies" přes @@map.
ALTER TABLE "companies" ADD COLUMN "verified_bank_accounts" JSONB NOT NULL DEFAULT '[]'::jsonb;
