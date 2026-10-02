-- Leasingovka: poptávky zasílat i SMS (e-mail vždy)
ALTER TABLE "leasing_companies" ADD COLUMN IF NOT EXISTS "send_sms" BOOLEAN NOT NULL DEFAULT true;
