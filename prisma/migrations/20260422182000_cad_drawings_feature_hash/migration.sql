-- Přidává feature_hash — SHA-256 hash feature-tree SolidWorks modelu.
-- Skutečný indikátor změny geometrie, nemění se jen při prostém Save.
ALTER TABLE "cad_drawings" ADD COLUMN "feature_hash" VARCHAR(64);
