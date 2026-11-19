-- Kolik z čekané změny umazaly nově naskočené poruchy. Jedna porucha jde
-- zpětně až o půl herního roku, takže bez tohohle sloupce nejde u rozdílu
-- poznat, jestli za ním stojí porucha, nebo něco jiného.
ALTER TABLE "game_snapshots" ADD COLUMN IF NOT EXISTS "poruchy" DOUBLE PRECISION;
