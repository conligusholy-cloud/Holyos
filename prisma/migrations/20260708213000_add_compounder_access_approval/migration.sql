-- Schválení přístupu k portálu pro nezvané leady (source='access_request').
-- Null = přístup zatím neschválen. Ostatní zdroje leadu pole ignorují.
ALTER TABLE "compounder_leads" ADD COLUMN "access_approved_at" TIMESTAMP(3);
