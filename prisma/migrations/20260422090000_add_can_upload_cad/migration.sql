-- Přidání obecného oprávnění na vkládání CAD výkresů ze SolidWorks
-- přes desktop klient HolyOS CAD Bridge. Default false (musí být explicitně povoleno).
ALTER TABLE "people" ADD COLUMN "can_upload_cad" BOOLEAN NOT NULL DEFAULT false;
