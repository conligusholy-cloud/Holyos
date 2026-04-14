-- Přidání příznaku externího pracoviště (kooperace)
ALTER TABLE "workstations" ADD COLUMN "is_external" BOOLEAN NOT NULL DEFAULT false;
