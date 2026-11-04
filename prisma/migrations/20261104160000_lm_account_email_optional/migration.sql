-- Účet na laundromats.eu smí vzniknout i bez e-mailu (zákazník ho doplní na aktivačním
-- odkazu). Unikátnost zůstává — Postgres povoluje víc NULL hodnot v UNIQUE sloupci.
ALTER TABLE "lm_accounts" ALTER COLUMN "email" DROP NOT NULL;
