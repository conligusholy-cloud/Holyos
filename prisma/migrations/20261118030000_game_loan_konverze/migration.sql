-- Konverze půjčky na nově vydaný podíl.
-- Zástava podílem už ve hře je a při nezaplacené splátce přejde věřiteli.
-- Má ale jeden strop: zastavit jde jen podíl, který je ve firmě ještě volný.
-- Kdo prodal všechno, nemá co zastavit — a je to přitom přesně ta firma,
-- která záchranné peníze potřebuje nejvíc.
--
-- Konverze tenhle strop nemá: podíl se při ní vydá nově a všichni dosavadní
-- se o stejný poměr zředí, úplně stejně jako u kapitálového vstupu.
ALTER TABLE "game_loans" ADD COLUMN IF NOT EXISTS "konverze_podil" DOUBLE PRECISION;
