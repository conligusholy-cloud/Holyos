# Slovník pojmů — překlad hry do němčiny

Závazné překlady herních pojmů. Bez nich je prádlomat jednou `Waschsalon`
a podruhé `Münzwäscherei`, a hráč si myslí, že jsou to dvě věci.
Tenhle soubor čte automatický překlad — co je tady, to platí.

> **POZOR, tenhle slovník ještě neviděl Němec.** Je to první návrh. Každá
> chyba v něm se promítne do všech tří tisíc klíčů najednou, takže ho má
> projít někdo, kdo německy umí, DŘÍV, než se pustí automatický překlad.
> Až to projde, smaž tenhle odstavec.

| česky | německy | pozn. |
|---|---|---|
| prádlomat | Waschsalon | nikdy *Münzwäscherei*; v UI krátce `Salon`, když je málo místa |
| pračka | Waschmaschine | stroj, ne provozovna |
| sušička | Trockner | |
| síť (prádlomatů) | Kette | ne *Netzwerk* |
| místo / stání | Standort | místo pro jeden stroj |
| pozemek | Grundstück | koupená půda |
| pobočka | Depot | základna pro dopravu a četu |
| četa | Trupp | vlastní stavební parta |
| hodnost | Rang | |
| odznak | Abzeichen | |
| meta | Meilenstein | |
| burza | Börse | obchody mezi hráči |
| tržiště | Marktplatz | prádlomaty na prodej na mapě |
| dražba | Auktion | |
| příhoz | Gebot | |
| vyvolávací cena | Startpreis | |
| doplatek | Restzahlung | co doplatí vítěz dražby |
| podíl | Anteil | podíl ve firmě |
| odkup | Rückkauf | majitel kupuje podíl zpět |
| převod | Übertragung | podíl na třetího |
| rámec | Kreditrahmen | limit v bance |
| zástava | Sicherheit | krytí úvěru; ne *Pfand* |
| splátka | Rate | |
| úrok | Zinsen | |
| infolinka | Hotline | |
| hovor | Anruf | |
| hvězdičky | Sterne | hodnocení zákazníků |
| pověst | Ruf | |
| doručenka | Lieferung | co čeká na vyzvednutí |
| čisté jmění | Nettovermögen | |
| zbyde měsíčně | bleibt monatlich | co zbyde po všem |
| herní měsíc | Spielmonat | 12 skutečných hodin |
| herní den | Spieltag | |
| krize | Krise | |
| konkurzní rozprodej | Insolvenzverkauf | |
| nájem | Miete | |
| přípojka | Anschluss | voda, elektrika |
| obrat | Umsatz | |
| zisk | Gewinn | |
| technik | Techniker | |
| vedoucí servisních techniků | Serviceleiter | předplatné |
| porucha | Störung | |
| výjezd | Einsatz | technik jede k poruše |
| prozkoumat město | Stadt erkunden | |
| Kč | (nepřekládat) | **skutečné peníze, ne herní měna.** Nikdy na L$. A nikdy na €: značku dosazuje server podle toho, kde hráč platí. Jediná výjimka je klíč `obecne.mena_vychozi`, který je sám značkou měny. |
| L$ | L$ | herní měna, zůstává vždycky L$ |

## Tykání

Hra tyká. Německy tedy **du**, nikdy *Sie* — a to důsledně, včetně tvarů
`dein`, `dir`, `dich`. Jedno vykání uprostřed hry zní, jako by mluvil někdo
jiný.

## Délka

Němčina skládá slova a bývá o polovinu delší než čeština. **Popisky tlačítek
a hlaviček drž krátké** — když se dá vybrat mezi `Zahlungsübersicht` a
`Zahlungen`, patří tam to druhé. Na telefonu je na tlačítko místo asi na
dvacet znaků. Prohlídka na dlouhé popisky upozorní, ale opravit je musí
člověk.

## Co se nepřekládá

`L$` je herní měna a zůstává `L$` ve všech jazycích. Značku skutečné měny
(Kč, €, $, zł) si vybírá server podle jazyka hráče a dosazuje ji sám —
v textech se nesmí objevit natvrdo.

Značky `{takhle}` a HTML včetně `id` a `class` zůstávají přesně, jak jsou.
Hra se podle nich řídí.

## Množné číslo

Němčina má dva tvary jako angličtina: `one` a `other`. Tvary `few` ani
`many` nepotřebuje.

## Tón

Krátké věty, bez marketingu. Hra mluví na hráče přímo a věcně, občas suše.
Německy stejně: `Bau ihn.` ne `Vielleicht möchtest du einen bauen?`
