-- Sekce „Příklad" (skládačka portfolia) — per-lead gate + uložený model zákazníka.
ALTER TABLE "compounder_leads" ADD COLUMN "show_example" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "compounder_leads" ADD COLUMN "example_model" TEXT;
