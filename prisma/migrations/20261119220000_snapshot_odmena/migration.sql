-- Kolik z čekané změny je denní odměna a kolik zaplacené opravy. Bez toho se
-- u rozcházejících se čísel nepozná, jestli za tím stojí vyzvednutá odměna
-- (poctivý příjem, o kterém server dřív nevěděl), nebo něco jiného.
ALTER TABLE "game_snapshots" ADD COLUMN IF NOT EXISTS "odmena" DOUBLE PRECISION;
ALTER TABLE "game_snapshots" ADD COLUMN IF NOT EXISTS "opravy" DOUBLE PRECISION;
