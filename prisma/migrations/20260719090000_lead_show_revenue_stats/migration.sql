-- Zda zákazník v portálu (Investor) vidí statistiky tržeb lokalit. Default false.
ALTER TABLE "compounder_leads" ADD COLUMN IF NOT EXISTS "show_revenue_stats" BOOLEAN NOT NULL DEFAULT false;
