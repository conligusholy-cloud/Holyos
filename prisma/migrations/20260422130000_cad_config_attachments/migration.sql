-- Přílohy ke konfiguraci CAD výkresu (STEP, DXF, EASM, EPRT, IGES a další
-- vedlejší exporty). Formát v JSON: [{ kind, filename, path, size }].
ALTER TABLE "cad_drawing_configs" ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]';
