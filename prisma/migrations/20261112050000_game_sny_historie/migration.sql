-- Splněný sen se z nástěnky ztratí, když ho hráč prodá nebo smaže — ale
-- nezmizí nadobro. Zůstane v historii u profilu, i s fotkou.
ALTER TABLE "game_dreams" ADD COLUMN IF NOT EXISTS "smazano_at" TIMESTAMP(3);
