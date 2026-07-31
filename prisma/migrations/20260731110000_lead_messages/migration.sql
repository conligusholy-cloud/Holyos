-- Historie komunikace s leadem (oslovení napříč kanály + AI návrhy).
CREATE TABLE "lead_messages" (
    "id" SERIAL NOT NULL,
    "lead_id" INTEGER NOT NULL,
    "channel" VARCHAR(20) NOT NULL DEFAULT 'note',
    "direction" VARCHAR(10) NOT NULL DEFAULT 'out',
    "subject" VARCHAR(300),
    "body" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "generated_by_ai" BOOLEAN NOT NULL DEFAULT false,
    "created_by_person_id" INTEGER,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_messages_lead_id_created_at_idx" ON "lead_messages"("lead_id", "created_at");

ALTER TABLE "lead_messages" ADD CONSTRAINT "lead_messages_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "compounder_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
