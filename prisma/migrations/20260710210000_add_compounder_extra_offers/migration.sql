-- Individuální nabídka lokalit navíc pro konkrétního leada (CSV kódů kiosků).
-- Lead vidí společnou nabídku (forSale) PLUS tyto lokality.
ALTER TABLE "compounder_leads" ADD COLUMN "extra_offers" TEXT;
