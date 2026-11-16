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
