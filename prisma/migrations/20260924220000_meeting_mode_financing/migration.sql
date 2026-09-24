-- Schůzka: forma (online/osobně) + zvolená cesta pořízení (vlastní kapitál/financování)
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "schuzka_mode" VARCHAR(20);
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "financing_path" VARCHAR(20);
ALTER TABLE "meeting_reservations" ADD COLUMN IF NOT EXISTS "mode" VARCHAR(20);
ALTER TABLE "meeting_reservations" ADD COLUMN IF NOT EXISTS "financing_path" VARCHAR(20);
