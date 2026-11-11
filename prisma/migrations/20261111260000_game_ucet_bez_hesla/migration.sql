-- Hráč si na úvodce vymyslí jen nick a název firmy a hraje. Heslo si k účtu
-- doplní až později — do té doby ho drží přihlášená cookie, proto tu smí být
-- účet bez hesla. Přihlásit se bez něj nejde, a hra na to upozorňuje.
ALTER TABLE "game_players" ALTER COLUMN "password_hash" DROP NOT NULL;
