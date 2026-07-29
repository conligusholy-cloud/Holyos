-- HolyOS — CRM databáze leadů (import z předchozího CRM po deduplikaci)
CREATE TABLE "crm_leads" (
    "id" SERIAL NOT NULL,
    "dedup_key" VARCHAR(140) NOT NULL,
    "first_name" VARCHAR(200),
    "last_name" VARCHAR(200),
    "email" VARCHAR(255),
    "phone" VARCHAR(60),
    "city" VARCHAR(200),
    "country" VARCHAR(120),
    "status" VARCHAR(60),
    "segment" VARCHAR(20) NOT NULL DEFAULT 'ostatni',
    "contactable" BOOLEAN NOT NULL DEFAULT false,
    "owner_name" VARCHAR(200),
    "source" VARCHAR(300),
    "note" TEXT,
    "dup_count" INTEGER NOT NULL DEFAULT 0,
    "crm_created_at" TIMESTAMP(3),
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crm_leads_dedup_key_key" ON "crm_leads"("dedup_key");
CREATE INDEX "crm_leads_segment_idx" ON "crm_leads"("segment");
CREATE INDEX "crm_leads_contactable_idx" ON "crm_leads"("contactable");
CREATE INDEX "crm_leads_country_idx" ON "crm_leads"("country");
CREATE INDEX "crm_leads_owner_name_idx" ON "crm_leads"("owner_name");
