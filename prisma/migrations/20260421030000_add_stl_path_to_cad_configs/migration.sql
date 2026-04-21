-- Přidání cesty k STL souboru pro webový 3D viewer (Three.js + STLLoader).
-- Desktop CAD bridge exportuje STL při submit-u vedle PNG a PDF;
-- server STL ukládá jako statický asset, browser ho rendruje lokálně.

ALTER TABLE "cad_drawing_configs"
  ADD COLUMN "stl_path" VARCHAR(500);
