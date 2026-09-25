-- Leasing: dokumenty vyžadované k žádosti o financování (dle typu žadatele)
CREATE TABLE "leasing_documents" (
  "id" SERIAL NOT NULL,
  "leasing_company_id" INTEGER NOT NULL,
  "category" VARCHAR(20) NOT NULL,
  "title" VARCHAR(300) NOT NULL,
  "file_path" VARCHAR(500),
  "mime_type" VARCHAR(80),
  "size_bytes" INTEGER,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leasing_documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "leasing_documents_leasing_company_id_idx" ON "leasing_documents"("leasing_company_id");
CREATE INDEX "leasing_documents_category_idx" ON "leasing_documents"("category");
ALTER TABLE "leasing_documents" ADD CONSTRAINT "leasing_documents_leasing_company_id_fkey"
  FOREIGN KEY ("leasing_company_id") REFERENCES "leasing_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
