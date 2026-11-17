# Slovník pojmů — překlad hry do španělštiny

Závazné překlady herních pojmů. Bez nich je prádlomat jednou `lavandería
autoservicio` a podruhé `lavandería de autoservicio`, a hráč si myslí, že
jsou to dvě věci. Tenhle soubor čte automatický překlad — co je tady, to platí.

> **POZOR, tenhle slovník ještě neviděl Španěl.** Je to první návrh. Každá
> chyba v něm se promítne do všech tří tisíc klíčů najednou, takže ho má
> projít někdo, kdo španělsky umí, DŘÍV, než se pustí automatický překlad.
> Až to projde, smaž tenhle odstavec.

| česky | španělsky | pozn. |
|---|---|---|
| prádlomat | lavandería | plně `lavandería autoservicio`; v UI krátce `lavandería` |
| pračka | lavadora | stroj, ne provozovna |
| sušička | secadora | |
| síť (prádlomatů) | cadena | ne *red* |
| místo / stání | ubicación | místo pro jeden stroj |
| pozemek | terreno | koupená půda |
| pobočka | base | základna pro dopravu a četu |
| četa | cuadrilla | vlastní stavební parta |
| hodnost | rango | |
| odznak | insignia | |
| meta | hito | |
| burza | mercado de socios | obchody mezi hráči; ne *bolsa* (to je akciová burza) |
| tržiště | mercado | prádlomaty na prodej na mapě |
| dražba | subasta | |
| příhoz | puja | |
| vyvolávací cena | precio de salida | |
| doplatek | pago restante | co doplatí vítěz dražby |
| podíl | participación | podíl ve firmě |
| odkup | recompra | majitel kupuje podíl zpět |
| převod | traspaso | podíl na třetího |
| rámec | línea de crédito | limit v bance |
| zástava | garantía | krytí úvěru |
| splátka | cuota | |
| úrok | intereses | |
| infolinka | línea de atención | krátce `atención` |
| hovor | llamada | |
| hvězdičky | estrellas | hodnocení zákazníků |
| pověst | reputación | |
| doručenka | entrega | co čeká na vyzvednutí |
| čisté jmění | patrimonio neto | |
| zbyde měsíčně | queda al mes | co zbyde po všem |
| herní měsíc | mes de juego | 12 skutečných hodin |
| herní den | día de juego | |
| krize | crisis | |
| konkurzní rozprodej | liquidación por quiebra | |
| nájem | alquiler | |
| přípojka | acometida | voda, elektrika |
| obrat | facturación | |
| zisk | beneficio | |
| technik | técnico | |
| vedoucí servisních techniků | jefe de servicio | předplatné |
| porucha | avería | |
| výjezd | salida | technik jede k poruše |
| prozkoumat město | explorar la ciudad | |
| Kč | (nepřekládat) | **skutečné peníze, ne herní měna.** Nikdy na L$. A nikdy na €: značku dosazuje server podle toho, kde hráč platí. Jediná výjimka je klíč `obecne.mena_vychozi`, který je sám značkou měny. |
| L$ | L$ | herní měna, zůstává vždycky L$ |

## Tykání

Hra tyká. Španělsky tedy **tú**, nikdy *usted* — a důsledně, včetně tvarů
`tu`, `ti`, `tuyo` a sloves ve druhé osobě. Jedno vykání uprostřed hry zní,
jako by mluvil někdo jiný.

Pozor i na **vosotros vs ustedes**: hra mluví k jednomu hráči, takže množné
číslo se skoro nevyskytne — a když ano, drž evropskou španělštinu.

## Obrácená interpunkce

Otázky a zvolání mají ve španělštině znaménko i na začátku: `¿Začít znovu?`
→ `¿Empezar de nuevo?`, `Hotovo!` → `¡Listo!`. Na to se při překladu
zapomíná a je to hned vidět.

## Délka

Španělština bývá o čtvrtinu až třetinu delší než čeština. **Popisky tlačítek
a hlaviček drž krátké** — na telefonu je na tlačítko místo asi na dvacet
znaků. Prohlídka na dlouhé popisky upozorní, ale opravit je musí člověk.

## Co se nepřekládá

`L$` je herní měna a zůstává `L$` ve všech jazycích. Značku skutečné měny
(Kč, €, $, zł) si vybírá server podle jazyka hráče a dosazuje ji sám —
v textech se nesmí objevit natvrdo.

Značky `{takhle}` a HTML včetně `id` a `class` zůstávají přesně, jak jsou.
Hra se podle nich řídí.

## Množné číslo

Španělština má dva tvary jako angličtina: `one` a `other`. Tvary `few` ani
`many` nepotřebuje.

## Tón

Krátké věty, bez marketingu. Hra mluví na hráče přímo a věcně, občas suše.
Španělsky stejně: `Constrúyela.` ne `¿Por qué no considerar construir una?`
