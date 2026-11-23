# Překlady hry

## Jak se píšou texty

Česky, do `cs.json`. **Ne do kódu.** V `game.js` se text bere jedině přes
`tx('klic')`, případně `tx('klic', { nick: x })` s vloženými údaji.

```js
// špatně — tenhle text nikdy nebude anglicky
+ '<span>Volný rámec v bance</span>'
// správně
+ '<span>' + esc(tx('banka.volny_ramec')) + '</span>'
```

Scénáře infolinky jsou zvlášť v `linka.cs.json` — je to souvislá próza
a jako klíče by se v tom nedalo psát.

## Kde se katalog bere v prohlížeči

Čeština jde do stránky jako obyčejný skript `/game/texty-cs.js`, načtený
**před** `game.js`. Není to zbytečnost: ve sloučených šablonách je i kus
stavby okna včetně `id` prvků, takže kdyby katalog nebyl po ruce hned,
nezmizel by jen text — zmizelo by celé okno a hra by si sáhla na prvek,
co není. Cizí jazyk se pak dotáhne přes `/api/game/texty/<jazyk>` a češtinu
jen přebije. Čeština se proto nikdy netahá po drátě.

## Co pustit před nasazením

```
npm run texty:kontrola     # co chybí, co zestaralo, co se zapomnělo v kódu
npm run texty:prelozit     # dopřeloží chybějící a zastaralé (potřebuje ANTHROPIC_API_KEY)
```

Kontrola nikdy nasazení nezastaví — vrací jen kód 1, když je co dopřekládat,
aby se na ni dal pověsit automatický překlad. Kód 2 je jiná věc: v kódu je
klíč, ke kterému žádný text není, a hráč by ho viděl v okně holý.

Ručně to pouštět nemusíš. Zapni si háček a děje se to samo při commitu:

```
git config core.hooksPath nastroje/hooks
```

Podrobnosti v `nastroje/hooks/README.md`.

## Druhý jazyk: co pustit a v jakém pořadí

```
npm run texty:kontrola      # co chybí
npm run texty:prelozit      # dopřeloží
npm run texty:prohlidka     # co je přeložené ŠPATNĚ
```

Kontrola a prohlídka dělají každá něco jiného a obě jsou potřeba. Kontrola
hlídá, co ještě není přeložené — to hráče nebolí, hra spadne zpátky do
češtiny. Prohlídka hlídá to horší: že přeložené JE, ale rozbité. To projde
kolem všeho a pozná se až na hráčích.

Každá kontrola v prohlídce vznikla z chyby, která se opravdu stala:

| co hlídá | co se stalo |
|---|---|
| značky | Chybějící `{p1}` znamená, že z věty zmizí číslo. Hráč si přečte „Chybí ti ." a neví, kolik. |
| stavba | Ve sloučených šablonách je i HTML včetně `id`. Když překlad `id` ztratí, nezmizí text — rozsype se celé okno a hra si sáhne na prvek, co není. |
| měna | Kč jsou skutečné peníze, L$ herní. Z Kč se staly L$ na sedmnácti místech a v obchodě svítilo „49 L$" za něco za 49 Kč. |
| tvary | Angličtina má one/other, čeština one/few/other. Chybějící tvar znamená, že se u nějakého počtu nevypíše nic. |
| scénáře | Scénáře se překládaly podle `id`, a dva se stejným `id` si přepsaly překlad navzájem — jeden dostal text toho druhého i s jinými body. |
| zbytky | Text, co zůstal česky, nebo věta namíchaná z obou jazyků. |

`aria-label`, `title` a `alt` se do stavby nepočítají: čte je odečítač
obrazovky, je to text pro hráče a překládat se má.

Tvrdé nálezy **zastaví commit** (háček v `nastroje/hooks`). Chybějící překlad
ne — rozdělanou větu musí jít uložit.

## Jazyky, které hra umí

`cs` (zdroj), `en`, `pl`, `de`, `es`, `fr`, `pt` (brazilská), `it`.

Hráči se nabízí jen ten, který je přeložený aspoň z poloviny — viz
`jazykyHotove()` v `index.js`. Rozdělaný překlad vypadá jako rozbitá hra:
česká věta s cizí vlajkou.

## Co udělat navíc pro třetí jazyk

- Doplnit tvary množného čísla do `TVARY` v `nastroje/texty-prohlidka.js`.
  Čeština má one/few/other, angličtina one/other; ruština nebo polština mají
  svoje a bez doplnění by prohlídka chybějící tvar nenašla.
- `mn()` v `game.js` umí **jenom česká pravidla** (1 / 2–4 / 5+). Pro
  angličtinu to náhodou vychází, protože 2–4 i 5+ padnou na stejný tvar.
  U jazyka s jinými pravidly se ta volání musí přepsat na `tPocet()`, který
  bere tvary z katalogu.
- Přidat jazyk do `JAZYKY` v `texty/jadro.js` a do měn v
  `services/game/meny.js`, pokud se v něm platí jinou měnou.

## Jak se pozná, že překlad zestaral

U každého anglického textu je v `en.meta.json` otisk české předlohy. Když se
čeština změní, otisk nesedí a kontrola ten klíč nahlásí jako zastaralý.
Bez toho by se změna české věty tiše nepromítla a anglická verze by lhala.

## Vytahování textů ze starého kódu

```
npm run texty:vytahni -- <funkce> <predpona>            # nanečisto
npm run texty:vytahni -- <funkce> <predpona> --zapsat
```

Nástroj má dva průchody. První vytáhne samostatné texty, druhý
(`texty-vety.js`) slepí větu rozsekanou vloženým číslem do jedné šablony se
značkami — jinak by se v angličtině nedala poskládat, protože slovosled je
jiný. Co vzít nejde, nahlásí a nechá být.

Celý `game.js` je tímhle hotový: kontrola hlásí 0 českých textů v kódu.

Po každé dávce porovnej české vykreslení před a po — a porovnávej
**innerHTML, ne jen text**. Rozbité `id` na textu vidět není a otisk by
hlásil shodu, i když hra nefunguje. Jednou se to přesně takhle stalo.

## Slovník pojmů

`slovnik.md` je závazný a jde do zadání automatickému překladu. Bez něj by
z prádlomatu byl jednou laundromat a podruhé laundrette.
