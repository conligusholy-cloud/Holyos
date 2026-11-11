-- =============================================================================
-- Žádost o volno — volitelný čas u data od/do (požadavek #141)
-- =============================================================================
-- Čas je zvlášť vedle data (VARCHAR 'HH:MM'), ne součástí timestampu. Výpočty
-- nároku na dovolenou i propis do docházky počítají celé dny a tímhle se jich
-- vůbec nedotkneme. Prázdná hodnota = celodenní volno jako dosud.

ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "time_from" VARCHAR(5);
ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "time_to" VARCHAR(5);
