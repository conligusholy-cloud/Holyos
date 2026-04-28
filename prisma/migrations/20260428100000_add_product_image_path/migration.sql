-- Přidání sloupce image_path na model Product.
-- Slouží pro odkaz na lokálně uložený obrázek produktu (persistent volume /app/data/product-images/).
ALTER TABLE "products" ADD COLUMN "image_path" VARCHAR(255);
