-- Migration: business_tool_recipient_languages
-- Přidává sloupec `languages` (text[]) do tabulky business_tool_recipients.
-- Slouží pro výběr jazykových mutací (cs/en/de/fr/...) dostupných na veřejné
-- share stránce ekonomiky prádlomatu. První kód = výchozí jazyk.
--
-- Idempotentní (Railway pattern, viz holyos_prisma_migrate_workflow memory).

ALTER TABLE "business_tool_recipients"
  ADD COLUMN IF NOT EXISTS "languages" TEXT[] NOT NULL DEFAULT ARRAY['cs']::TEXT[];
