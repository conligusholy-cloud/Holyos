-- Přidej příznak zobrazení v konfigurátoru pro zákazníka
ALTER TABLE "products" ADD COLUMN "show_in_configurator" BOOLEAN NOT NULL DEFAULT false;
