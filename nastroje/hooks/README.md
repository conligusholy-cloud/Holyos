# Háčky do gitu

## Zapnutí (jednou, na každém stroji)

```
git config core.hooksPath nastroje/hooks
```

Od té chvíle se při každém commitu, který sahá na hru nebo na katalog textů,
spustí kontrola a dopřeložení.

## Co to dělá

`pre-commit` se podívá, jestli v katalogu nepřibyl text bez anglického
protějšku a jestli se některý český text nezměnil pod hotovým překladem.
Když ano a v prostředí je `ANTHROPIC_API_KEY`, nechá to dopřeložit a přidá
`en.json` a `en.meta.json` do stejného commitu. Česká a anglická verze tak
nikdy nejdou od sebe.

Commit se kvůli chybějícímu překladu nezastaví — hra spadne zpátky do
češtiny a hráč nic nepozná. Zastaví se jedině tehdy, když je v kódu použitý
klíč, ke kterému v katalogu není žádný text; to by hráč viděl jako holý klíč
v okně.

## Klíč k API

Bere se z prostředí, nikdy ze souboru v repozitáři. Ve Windows:

```
setx ANTHROPIC_API_KEY sk-ant-...
```

Pak nové okno terminálu. Ověření: `npm run texty:kontrola`.

## Ručně, bez commitu

```
npm run texty:kontrola      # co chybí a co je zastaralé
npm run texty:prelozit      # dopřeložit
node nastroje/texty-prelozit.js --nanecisto   # ukázat, co by přeložil
```
