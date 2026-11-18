-- Dohled: co by server odmítl, kdyby už odmítal.
--
-- Hra má dvě pojistky, které zatím jen mlčky píšou do konzole: strop
-- přírůstku hotovosti a povinný sklad při stavbě. Obě čekají na jedno a
-- totéž rozhodnutí — jestli už smí doopravdy odmítat — a to rozhodnutí
-- potřebuje čísla, ne dojem.
--
-- Strop si otisky ukládá do game_snapshots, takže o něm čísla máme. Sklad
-- je psal jen do logu, kam se z běžného provozu nikdo nepodívá. Od téhle
-- tabulky je má kde počítat.
--
-- Je to záznam o chování hry, ne obvinění hráče: řádka tu vznikne i tehdy,
-- když si hráč koupil stroj dřív, než se nákupy vůbec začaly zapisovat.
-- Právě proto se to počítá, než se začne odmítat.
CREATE TABLE IF NOT EXISTS "game_dohled" (
  "id"         SERIAL PRIMARY KEY,
  "player_id"  INTEGER NOT NULL,
  "druh"       VARCHAR(16) NOT NULL,
  "detail"     VARCHAR(200),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "game_dohled_druh_created_at_idx" ON "game_dohled" ("druh", "created_at");
CREATE INDEX IF NOT EXISTS "game_dohled_player_id_idx" ON "game_dohled" ("player_id");
