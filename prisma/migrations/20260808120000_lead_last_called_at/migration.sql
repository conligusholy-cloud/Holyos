-- Evidence kliknutí na „Volat" u leadu (poslední pokus o hovor)
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "last_called_at" TIMESTAMP(3);
