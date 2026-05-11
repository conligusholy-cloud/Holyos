-- AI suitability scoring (Fáze 4): Claude haiku hodnotí AdminTask před vytvořením
-- v UI. Score 0-100 (vyšší = vhodnější pro AI Vývojáře), reasoning text + timestamp.

ALTER TABLE "admin_tasks"
  ADD COLUMN IF NOT EXISTS "ai_suitability_score" INTEGER,
  ADD COLUMN IF NOT EXISTS "ai_suitability_reasoning" TEXT,
  ADD COLUMN IF NOT EXISTS "ai_suitability_at" TIMESTAMPTZ;
