-- Všechny další sloupce z importu Excelu (klíč = název sloupce).
ALTER TABLE "service_machines" ADD COLUMN "extra" JSONB;
