-- Order: způsob financování (vlastní zdroje / leasing) + leasingová společnost
ALTER TABLE "orders" ADD COLUMN "financing_type" VARCHAR(20);
ALTER TABLE "orders" ADD COLUMN "leasing_company_id" INTEGER;
