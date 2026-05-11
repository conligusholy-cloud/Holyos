-- AdminTask: viditelnost kdo na úkolu pracuje
-- assigned_to: FK na users (řešitel), assigned_at: kdy byl převzat
-- Auto-claim probíhá při změně status → in_progress v PUT routě.

ALTER TABLE "admin_tasks"
  ADD COLUMN IF NOT EXISTS "assigned_to" INTEGER,
  ADD COLUMN IF NOT EXISTS "assigned_at" TIMESTAMP(3);

-- FK na users (s ON DELETE SET NULL, ať se nepoškodí historie když user zmizí).
-- DO bloček, ať migrace nepadla na duplicitě v případě re-runu (Railway resolve).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_tasks_assigned_to_fkey'
  ) THEN
    ALTER TABLE "admin_tasks"
      ADD CONSTRAINT "admin_tasks_assigned_to_fkey"
      FOREIGN KEY ("assigned_to") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "admin_tasks_assigned_to_idx" ON "admin_tasks"("assigned_to");
