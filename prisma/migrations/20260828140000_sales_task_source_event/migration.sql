-- Vazba úkolu na kalendářní událost (SalesEvent), ze které vznikl.
-- Po splnění/přeskočení úkolu se událost zavře, aby se prošvihnutý krok nevracel.
ALTER TABLE "sales_tasks" ADD COLUMN IF NOT EXISTS "source_event_id" INTEGER;
CREATE INDEX IF NOT EXISTS "sales_tasks_source_event_id_idx" ON "sales_tasks"("source_event_id");
