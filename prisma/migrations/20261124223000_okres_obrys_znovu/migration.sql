-- Zahodit obrysy stažené hledáním podle jména.
--
-- Obrys se hledal podle jména okresu a „okres Šumperk" trefilo MĚSTO Šumperk,
-- takže na mapě svítila obec místo okresu. Hledání je opravené (obrys se bere
-- z téhož dotazu, který okres určí), ale uložené obrysy by se už nikdy
-- nestáhly znovu — zajisti() na vyplněné hranici končí. Vyprázdnit je je
-- levnější než je opravovat: stáhnou se samy při prvním pohledu na mapu.
UPDATE "game_okresy" SET "hranice" = NULL;
