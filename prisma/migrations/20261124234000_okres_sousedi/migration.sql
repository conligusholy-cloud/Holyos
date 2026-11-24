-- S kým okres sousedí. Území se má dát rozšiřovat o kus vedle a k tomu musí
-- hra vědět, co vedle je. Tabulka sousedů v OSM není, takže se kolem obrysu
-- sáhne kousek ven a zeptá se, který okres tam je — a výsledek se uloží sem,
-- protože je to dvanáct dotazů na cizí službu a dělat je pokaždé znovu by
-- bylo nezdvořilé i pomalé.
ALTER TABLE "game_okresy" ADD COLUMN "sousedi" JSONB;
