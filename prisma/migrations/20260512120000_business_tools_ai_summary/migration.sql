-- HolyOS — Obchodní pomůcky: AI shrnutí chování zákazníka (cache)
-- Claude se volá na vyžádání z admin pohledu; text se kešuje, aby se Claude
-- nevolal při každém otevření detail modalu.

ALTER TABLE "business_tool_recipients"
  ADD COLUMN IF NOT EXISTS "ai_summary_text" TEXT,
  ADD COLUMN IF NOT EXISTS "ai_summary_generated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ai_summary_model" VARCHAR(60);
