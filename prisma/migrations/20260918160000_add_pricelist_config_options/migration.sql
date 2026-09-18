-- Volitelná výbava/konfigurace u položky ceníku (skupiny voleb, zatím bez příplatků)
ALTER TABLE "sales_pricelist_items" ADD COLUMN "config_options" JSONB;
