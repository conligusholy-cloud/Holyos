-- Drobná nastavení hry cvakatelná z administrace (zatím zrychlený onboarding).
CREATE TABLE IF NOT EXISTS "game_settings" (
  "klic"       VARCHAR(40) PRIMARY KEY,
  "hodnota"    VARCHAR(200) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
