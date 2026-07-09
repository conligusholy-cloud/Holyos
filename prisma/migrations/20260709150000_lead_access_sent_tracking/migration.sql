-- Sledování odeslání přístupu na portál: počítadlo + čas posledního odeslání.
ALTER TABLE "compounder_leads" ADD COLUMN "access_sent_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "compounder_leads" ADD COLUMN "access_last_sent_at" TIMESTAMP(3);
