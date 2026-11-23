# Slovník pojmů — překlad hry do italštiny

Závazné překlady herních pojmů. Bez nich je prádlomat jednou `lavanderia`
a podruhé `lavanderia automatica`, a hráč si myslí, že jsou to dvě věci.
Tenhle soubor čte automatický překlad — co je tady, to platí.

> **POZOR, tenhle slovník ještě neviděl Ital.** Je to první návrh. Každá
> chyba v něm se promítne do všech čtyř tisíc klíčů najednou, takže ho má
> projít někdo, kdo italsky umí, DŘÍV, než se pustí automatický překlad.
> Až to projde, smaž tenhle odstavec.

| česky | italsky | pozn. |
|---|---|---|
| prádlomat | lavanderia | plně `lavanderia self-service`; nikdy *lavanderia a gettoni* (to je starý automat na žetony) |
| pračka | lavatrice | stroj, ne provozovna |
| sušička | asciugatrice | |
| síť (prádlomatů) | rete | |
| místo / stání | postazione | místo pro jeden stroj |
| pozemek | terreno | koupená půda |
| pobočka | filiale | základna pro dopravu a četu |
| četa | squadra | vlastní stavební parta |
| hodnost | grado | |
| odznak | distintivo | |
| meta | traguardo | |
| burza | borsa scambi | obchody mezi hráči; nikdy samotné *borsa* (to je akciová burza) |
| tržiště | mercato | hotové prádlomaty na prodej |
| dražba | asta | |
| příhoz | offerta | v dražbě; ne *rilancio*, to zní dražebnicky |
| vyvolávací cena | prezzo base | |
| doplatek | saldo da pagare | co doplatí vítěz dražby |
| podíl | quota | podíl ve firmě |
| akcie | azione | akcie fondu, jiná věc než podíl |
| fond | fondo | společná kasa aliance |
| aliance | alleanza | |
| odkup | riacquisto | majitel kupuje podíl zpět |
| převod | cessione | podíl na třetího |
| rámec | fido | limit v bance; ne *linea di credito*, je to dlouhé |
| zástava | garanzia | krytí úvěru |
| úvěr | prestito | |
| splátka | rata | |
| úrok | interessi | vždy množné |
| mimořádná splátka | rimborso anticipato | |
| infolinka | assistenza clienti | krátce `assistenza`, když je málo místa |
| hovor | chiamata | |
| hvězdičky | stelle | hodnocení zákazníků |
| pověst | reputazione | |
| doručenka | consegna | co čeká na vyzvednutí |
| čisté jmění | patrimonio netto | |
| zbyde měsíčně | resta al mese | co zbyde po všem |
| herní měsíc | mese di gioco | 12 skutečných hodin |
| herní den | giorno di gioco | |
| krize | crisi | |
| konkurzní rozprodej | liquidazione fallimentare | |
| nájem | affitto | nikdy *noleggio* (to je půjčovna věcí) |
| přípojka | allacciamento | voda, elektrika — `allacciamento idrico`, `allacciamento elettrico` |
| obrat | fatturato | |
| zisk | utile | ne *profitto*, účetně je to utile |
| tržba | incasso | co se vybere na místě |
| technik | tecnico | |
| vedoucí servisních techniků | responsabile manutenzione | předplatné |
| porucha | guasto | |
| výjezd | intervento | technik jede k poruše |
| prozkoumat město | esplora la città | |
| návštěvnost | affluenza | kolik lidí chodí |
| kampaň | campagna | karta na návštěvnost |
| karta | carta | zrychlující karta |
| zločin | reato | řízení o podvodu |
| kontrola | verifica | první fáze řízení; ne *controllo* (to je i ovládání) |
| soud | tribunale | |
| porota | giuria | |
| odvolání | ricorso | |
| škoda | danno | |
| trest | sanzione | peněžitý; ne *pena* (to zní trestněprávně) |
| zmrazeno | congelato | zmrazený majetek |
| Kč | (nepřekládat) | **skutečné peníze, ne herní měna.** Nikdy na L$. A nikdy na €: značku dosazuje server podle toho, kde hráč platí. |
| L$ | L$ | herní měna, zůstává vždycky L$ |

## Dvě slova, která se perou

`affitto` i `noleggio` znamenají nájem. V téhle hře se pronajímá **plocha
pod prádlomatem**, tedy nemovitost — a to je vždycky `affitto`. `Noleggio`
by znamenalo, že si hráč půjčuje pračku.

Stejně tak `verifica` a `controllo`: řízení o zločinu začíná `verifica`
(kontrola účetnictví). `Controllo` v italštině stejně často znamená ovládání
a v herním rozhraní by to pletlo.

## Tykání

Hra tyká. Italsky je to druhá osoba jednotného čísla (`tu`) — `Costruisci`,
`Hai`, `Puoi`. Nikdy vykání `Lei` (`Costruisca`, `Ha`, `Può`): v italském
rozhraní her a aplikací se tyká a vykání by znělo jako dopis z úřadu.
Přivlastňovací je `tuo` / `tua`.

## Žádná mezera před dvojitou interpunkcí

Tohle je francouzská věc, italština ji nemá: `Pronto?`, `Prezzo:`,
ne *`Pronto ?`*. Kdyby se překlad dělal z francouzštiny, tahle mezera se
veze s sebou — musí pryč.

## Apostrof

Italština apostrofuje často (`l'affitto`, `un'offerta`, `dell'impianto`).
Piš typografický apostrof `’`, ne rovnou čárku `'` — rovná by rozbila JSON,
ve kterém překlad odpovídá. Pozor na rod: `un'offerta` (ženský) ale
`un impianto` (mužský, bez apostrofu).

## Nula je množné číslo

Na rozdíl od francouzštiny a portugalštiny bere italština nulu jako množné
číslo: `0 lavanderie`, ne *`0 lavanderia`*. Tvar `one` tedy platí jen pro
jedničku. Tvary jsou dva — `one` a `other`.

## Délka

Italština bývá o pětinu až třetinu delší než čeština. **Popisky tlačítek
a hlaviček drž krátké** — na telefonu je na tlačítko místo asi na dvacet
znaků. Kde se to nevejde, zkrať podstatné jméno (`assistenza` místo
`assistenza clienti`), ne sloveso. Prohlídka na dlouhé popisky upozorní,
ale opravit je musí člověk.

## Co se nepřekládá

`L$` je herní měna a zůstává `L$` ve všech jazycích. Značku skutečné měny
(Kč, €, $, zł) si vybírá server podle jazyka hráče a dosazuje ji sám —
v textech se nesmí objevit natvrdo.

Značky `{takhle}` a HTML včetně `id` a `class` zůstávají přesně, jak jsou.
Hra se podle nich řídí.

## Tón

Krátké věty, bez marketingu. Hra mluví na hráče přímo a věcně, občas suše.
Italsky stejně: `Costruisci.` ne `Perché non prendere in considerazione la
costruzione di una nuova lavanderia?`
