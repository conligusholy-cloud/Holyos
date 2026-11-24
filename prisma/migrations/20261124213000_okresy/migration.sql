-- Území Unie je okres, ne město.
--
-- Území se dosud vázalo na město a na mapě se kreslilo jako kruh o sedmi
-- kilometrech kolem jeho středu. Byla to kresba bez podkladu: dvě města
-- v jednom okrese by se překrývala a hráč nepoznal, kde území končí.
--
-- Okres je skutečná hranice. Stáhne se jednou z OpenStreetMap a uloží se sem,
-- ať mapa nečeká na cizí službu. Sloupce area_key v územích a licencích
-- zůstávají, jen v nich nově leží klíč okresu — proto se data nestěhují.
CREATE TABLE "game_okresy" (
  "id"         SERIAL PRIMARY KEY,
  "key"        VARCHAR(80) NOT NULL,
  "nazev"      VARCHAR(120) NOT NULL,
  "zeme"       VARCHAR(2),
  "lat"        DOUBLE PRECISION,
  "lon"        DOUBLE PRECISION,
  "hranice"    JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "game_okresy_key_key" ON "game_okresy"("key");

-- Do kterého okresu město patří. Doplní se při prvním dotazu.
ALTER TABLE "game_areas" ADD COLUMN "okres_key" VARCHAR(80);
ALTER TABLE "game_areas" ADD COLUMN "okres_nazev" VARCHAR(120);
