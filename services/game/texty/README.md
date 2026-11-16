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

## Co pustit před nasazením

```
npm run texty:kontrola     # co chybí, co zestaralo, co se zapomnělo v kódu
npm run texty:prelozit     # dopřeloží chybějící a zastaralé (potřebuje ANTHROPIC_API_KEY)
```

Kontrola nikdy nasazení nezastaví — vrací jen kód 1, když je co dopřekládat,
aby se na ni dal pověsit automatický překlad.

## Jak se pozná, že překlad zestaral

U každého anglického textu je v `en.meta.json` otisk české předlohy. Když se
čeština změní, otisk nesedí a kontrola ten klíč nahlásí jako zastaralý.
Bez toho by se změna české věty tiše nepromítla a anglická verze by lhala.

## Vytahování textů ze starého kódu

```
npm run texty:vytahni -- <funkce> <predpona>            # nanečisto
npm run texty:vytahni -- <funkce> <predpona> --zapsat
```

Nástroj se **nedotkne vět rozsekaných vloženým číslem** („. Máš",
„, takže klid.") — ty se v angličtině skládají jinak a musí se přepsat ručně
na šablonu se značkami. Nahlásí je a nechá být.

Po každé dávce porovnej české vykreslení před a po. Dokud sedí čeština,
přepis nic nerozbil.

## Slovník pojmů

`slovnik.md` je závazný a jde do zadání automatickému překladu. Bez něj by
z prádlomatu byl jednou laundromat a podruhé laundrette.
