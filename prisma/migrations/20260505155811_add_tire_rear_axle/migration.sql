-- =============================================================================
-- HolyOS — TireStockItem: přidání zadní sady pneu
-- =============================================================================
-- Stávající pole tire_size/manufacturer/model_name/dot_code/tread_depth_mm
-- se nově interpretují jako PŘEDNÍ sada. Když je rear_* NULL, znamená to,
-- že zadní sada je identická s přední (typický případ pro většinu aut).

ALTER TABLE "tire_stock_items"
  ADD COLUMN "rear_tire_size"      VARCHAR(100),
  ADD COLUMN "rear_manufacturer"   VARCHAR(100),
  ADD COLUMN "rear_model_name"     VARCHAR(255),
  ADD COLUMN "rear_dot_code"       VARCHAR(20),
  ADD COLUMN "rear_tread_depth_mm" DECIMAL(4, 1);
