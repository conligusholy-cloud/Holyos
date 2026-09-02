-- Chat s AI specialistou na portálu — historie zpráv per lead
CREATE TABLE "ai_specialist_messages" (
    "id" TEXT NOT NULL,
    "lead_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_specialist_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_specialist_messages_lead_id_idx" ON "ai_specialist_messages"("lead_id");

-- Uložené AI shrnutí chatu (co lead chce)
ALTER TABLE "compounder_leads" ADD COLUMN "ai_specialist_summary" TEXT;
