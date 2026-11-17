# Slovník pojmů — překlad hry do polštiny

Závazné překlady herních pojmů. Bez nich je prádlomat jednou `pralnia
samoobsługowa` a podruhé `pralnia`, a hráč si myslí, že jsou to dvě věci.
Tenhle soubor čte automatický překlad — co je tady, to platí.

> **POZOR, tenhle slovník ještě neviděl Polák.** Je to první návrh. Každá
> chyba v něm se promítne do všech tří tisíc klíčů najednou, takže ho má
> projít někdo, kdo polsky umí, DŘÍV, než se pustí automatický překlad.
> Až to projde, smaž tenhle odstavec.

| česky | polsky | pozn. |
|---|---|---|
| prádlomat | pralnia samoobsługowa | krátce v UI `pralnia`; nikdy *pralka* (to je pračka) |
| pračka | pralka | stroj, ne provozovna |
| sušička | suszarka | |
| síť (prádlomatů) | sieć | |
| místo / stání | lokalizacja | místo pro jeden stroj |
| pozemek | działka | koupená půda |
| pobočka | baza | základna pro dopravu a četu; ne *oddział* |
| četa | ekipa | |
| hodnost | ranga | |
| odznak | odznaka | |
| meta | kamień milowy | |
| burza | giełda | obchody mezi hráči |
| tržiště | targowisko | prádlomaty na prodej na mapě |
| dražba | licytacja | |
| příhoz | postąpienie | |
| vyvolávací cena | cena wywoławcza | |
| doplatek | dopłata | co doplatí vítěz dražby |
| podíl | udział | podíl ve firmě |
| odkup | odkup | majitel kupuje podíl zpět |
| převod | przeniesienie | podíl na třetího |
| rámec | limit kredytowy | limit v bance |
| zástava | zastaw | |
| splátka | rata | |
| úrok | odsetki | |
| infolinka | infolinia | |
| hovor | rozmowa | |
| hvězdičky | gwiazdki | hodnocení zákazníků |
| pověst | reputacja | |
| doručenka | przesyłka | co čeká na vyzvednutí |
| čisté jmění | majątek netto | |
| zbyde měsíčně | zostaje miesięcznie | co zbyde po všem |
| herní měsíc | miesiąc w grze | 12 skutečných hodin |
| herní den | dzień w grze | |
| krize | kryzys | |
| konkurzní rozprodej | wyprzedaż upadłościowa | |
| nájem | czynsz | |
| přípojka | przyłącze | voda, elektrika |
| obrat | obrót | |
| zisk | zysk | |
| technik | technik | |
| vedoucí servisních techniků | kierownik serwisu | předplatné |
| porucha | awaria | |
| výjezd | wyjazd | technik jede k poruše |
| prozkoumat město | zbadać miasto | |
| Kč | (nepřekládat) | **skutečné peníze, ne herní měna.** Nikdy na L$. A nikdy na zł: značku dosazuje server podle toho, kde hráč platí — Polák může platit v eurech. Jediná výjimka je klíč `obecne.mena_vychozi`, který je sám značkou měny. |
| L$ | L$ | herní měna, zůstává vždycky L$ |

## Co se nepřekládá

`L$` je herní měna a zůstává `L$` ve všech jazycích. Značku skutečné měny
(Kč, €, $, zł) si vybírá server podle jazyka hráče a dosazuje ji sám —
v textech se nesmí objevit natvrdo.

Značky `{takhle}` a HTML včetně `id` a `class` zůstávají přesně, jak jsou.
Hra se podle nich řídí.

## Množné číslo

Polština má čtyři tvary, v katalogu používáme tři: `one`, `few`, `many`.
`one` = 1, `few` = 2–4 na konci kromě 12–14 (22 ano, 12 ne), `many` = zbytek.
Tvar `other` polština nepotřebuje.

## Tón

Krátké věty, bez marketingu. Hra mluví na hráče přímo a věcně, občas suše.
Tykání, ne vykání — hráč je kamarád, ne zákazník v bance.
Polsky stejně: `Zbuduj ją.` ne `Może warto rozważyć budowę?`
