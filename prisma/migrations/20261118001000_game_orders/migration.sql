-- Objednané a skladem ležící stroje.
-- Nákup prádlomatu dosud žil jen v prohlížeči: server věděl, že se kupovalo
-- (platil z toho provizi), ale ne co a za kolik. Proto serverové jmění
-- nevidělo sklad ani zboží na cestě — u hráče uprostřed expanze je to
-- většina majetku.
--
-- Jeden řádek = jeden stroj. Ve kterém je stavu, říkají data:
--   dorazi_at v budoucnu            → je na cestě
--   dorazi_at v minulosti, bez stavby → leží skladem
--   postaveno_at vyplněné           → stojí na místě spot_id
CREATE TABLE IF NOT EXISTS "game_orders" (
  "id"           SERIAL PRIMARY KEY,
  "player_id"    INTEGER NOT NULL,
  "model"        VARCHAR(10) NOT NULL,
  "cena"         INTEGER NOT NULL DEFAULT 0,
  "dorazi_at"    TIMESTAMP(3) NOT NULL,
  "postaveno_at" TIMESTAMP(3),
  "spot_id"      VARCHAR(120),
  "zruseno_at"   TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "game_orders_player_id_postaveno_at_idx"
  ON "game_orders"("player_id", "postaveno_at");
