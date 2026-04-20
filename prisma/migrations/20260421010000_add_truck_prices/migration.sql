-- Přidání kamionových (velkoobchodních) cen k položkám prodejního ceníku.
-- Stejně jako price_czk/eur jsou volitelné (NULL povoleno).

ALTER TABLE "sales_pricelist_items"
  ADD COLUMN "truck_price_czk" DECIMAL(12,2),
  ADD COLUMN "truck_price_eur" DECIMAL(12,2);
