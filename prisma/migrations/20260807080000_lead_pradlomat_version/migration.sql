-- Varianta prádlomatu na leadu (V2/V3) pro ekonomiku Provozovatele
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "pradlomat_version" VARCHAR(8) NOT NULL DEFAULT 'V3';
