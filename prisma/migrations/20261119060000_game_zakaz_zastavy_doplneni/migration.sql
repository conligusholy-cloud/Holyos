-- Blokační menšina: zákaz zastavit majetek firmy — doplnění.
--
-- Tahle migrace tu je podruhé a stojí za to říct proč. Složka
-- 20261118160000_game_zakaz_zastavy dostala omylem obsah předchozí migrace
-- (sloupce dividendy), takže se sloupec zakaz_zastavy nikdy nevytvořil.
-- Prisma si přitom migraci zapsala jako provedenou, protože ty příkazy
-- uvnitř proběhly — jen dělaly něco jiného.
--
-- Projevilo se to až v provozu: každý dotaz na podíly firmy spadl na
-- "column game_equity.zakaz_zastavy does not exist", takže hráčům přestala
-- fungovat vlastnická struktura i nástěnka firem v nouzi.
--
-- Opravit původní složku nejde — Prisma si k provedené migraci drží kontrolní
-- součet a změna by nasazení zastavila. Proto nová migrace se správným
-- obsahem.
--
-- Zákaz se drží u podílu, ne u člověka: kdo podíl prodá, prodá i zákaz
-- a novému držiteli začíná na vypnuté hodnotě.
ALTER TABLE "game_equity"
  ADD COLUMN IF NOT EXISTS "zakaz_zastavy" BOOLEAN NOT NULL DEFAULT false;
