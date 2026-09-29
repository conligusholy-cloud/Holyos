-- Leasing: AI vytěžené parametry nabídky financování
ALTER TABLE "leasing_documents" ADD COLUMN IF NOT EXISTS "params" JSONB;
