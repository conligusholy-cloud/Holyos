-- =============================================================================
-- HolyOS — Metodické pokyny a směrnice (Directive)
-- =============================================================================
-- Centrální evidence interních směrnic, metodických pokynů a postupů.
-- Každý dokument má kód, název, kategorii, verzi a stav. Přílohy (PDF, Word,
-- atd.) drží jako JSON pole referencí do /api/storage.

-- CreateTable
CREATE TABLE "directives" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "category" VARCHAR(50) NOT NULL DEFAULT 'obecne',
    "content" TEXT,
    "version" VARCHAR(20) NOT NULL DEFAULT '1.0',
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "effective_from" DATE,
    "effective_to" DATE,
    "tags" JSONB,
    "attachments" JSONB,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "directives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "directives_code_key" ON "directives"("code");
CREATE INDEX "directives_category_idx" ON "directives"("category");
CREATE INDEX "directives_status_idx" ON "directives"("status");
CREATE INDEX "directives_code_idx" ON "directives"("code");
