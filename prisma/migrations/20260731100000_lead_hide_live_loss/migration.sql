-- Schovat „živou ztrátu" v portálu tomuto leadovi (časomíra + „přišli jste o…" v liště
-- a karta „Cena vašeho váhání" v sekci Příklad). Výchozí false.
ALTER TABLE "compounder_leads" ADD COLUMN "hide_live_loss" BOOLEAN NOT NULL DEFAULT false;
