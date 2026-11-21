-- Úklid starých nabídek „k pronájmu" na zastavěných pozemcích.
--
-- Stavba na vlastním pozemku dosud nabídku pronájmu nemazala, takže na mapě
-- zůstal viset inzerát na zem, kterou si nikdo pronajmout nemohl: /spots/najmout
-- i /spots/pronajem pozemek se strojem odmítají. Od teď ji stavba maže, tohle
-- uklidí, co už viset zůstalo.
--
-- Zem prodaná pod cizím prádlomatem se NEuklízí: tam pronajem_cena není inzerát,
-- ale nájem, který provozovatel platí majiteli země (Požadavek #158). Stejně tak
-- se nesahá na pozemek, který má nájemce — tam je nesrovnalost jiného druhu
-- a patří se na ni podívat, ne ji přepsat.
UPDATE "game_spot_claims"
   SET "pronajem_cena" = NULL, "pronajem_sit" = false
 WHERE "model" <> ''
   AND "pronajem_cena" IS NOT NULL
   AND "pozemek_majitel_id" IS NULL
   AND "najemce_id" IS NULL;
