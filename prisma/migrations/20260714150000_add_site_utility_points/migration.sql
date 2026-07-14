-- Body přípojek (sloupky) označené zájemcem na mapě webu bestseries.global:
-- elektřina, voda, kanalizace, parkoviště. Uloženo jako JSON { klíč: {lat,lng} }.

ALTER TABLE "sites" ADD COLUMN "utility_points" JSONB;
