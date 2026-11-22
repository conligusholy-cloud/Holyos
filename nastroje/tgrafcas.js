// =============================================================================
// HolyOS — Laundromat Tycoon: grafy mají vodorovně čas, ne pořadí vzorku
// =============================================================================
// Hodnota fondu se vzorkuje jednou za hodinu, ale po každém pohybu penězi
// ještě navíc. Tři obchody v jedné minutě tak zabraly stejný kus šířky jako
// tři klidné hodiny a z grafu byl hřeben — na živých datech 200 vzorků,
// z toho 29 v jediné hodině, která zabírala 14,5 % šířky místo 1,4 %.
//
// Vzorky se proto slijí do stejně dlouhých oken (z každého zůstane ten
// poslední, jako závěrečná cena na burze) a kreslí se podle času.
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KOREN = path.join(__dirname, '..');
let chyb = 0;
function ma(podminka, popis, detail) {
  if (podminka) { console.log('  ok   ' + popis + (detail ? '  — ' + detail : '')); return; }
  chyb++; console.log('  CHYBA ' + popis + (detail ? '  — ' + detail : ''));
}
function telo(zdroj, jmeno) {
  const i = zdroj.indexOf('function ' + jmeno + '(');
  if (i < 0) throw new Error('funkce ' + jmeno + ' v souboru není');
  let hloubka = 0;
  for (let j = zdroj.indexOf('{', i); j < zdroj.length; j++) {
    if (zdroj[j] === '{') hloubka++;
    else if (zdroj[j] === '}') { hloubka--; if (!hloubka) return zdroj.slice(i, j + 1); }
  }
  throw new Error('funkce ' + jmeno + ' nemá konec');
}

const HRA = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.js'), 'utf8');
const ctx = vm.createContext({ Math, Number, Date, isFinite, console });
vm.runInContext(telo(HRA, 'vzorkyPoCase') + '\n' + telo(HRA, 'podilCasu')
  + '\nthis.A = vzorkyPoCase; this.B = podilCasu;', ctx);
const vzorkyPoCase = ctx.A, podilCasu = ctx.B;

const HOD = 3600000;
const T0 = Date.parse('2026-11-19T21:00:00Z');
function vzorek(t, v) { return { kdy: new Date(t).toISOString(), hodnota: v, cena: v }; }
// Kolikrát křivka obrátí směr — míra „zubatosti".
function zuby(body, klic) {
  let z = 0, smer = 0;
  for (let i = 1; i < body.length; i++) {
    const d = body[i][klic] - body[i - 1][klic];
    if (!d) continue;
    const s = d > 0 ? 1 : -1;
    if (smer && s !== smer) z++;
    smer = s;
  }
  return z;
}

// ─── 1. Shluk vzorků z jedné chvíle ─────────────────────────────────────────
{
  console.log('\nShluk obchodů z jedné minuty');
  const body = [];
  for (let h = 0; h < 70; h++) body.push(vzorek(T0 + h * HOD, 100 + h));      // klidné hodiny
  const kdy = T0 + 30 * HOD;
  for (let i = 0; i < 29; i++) body.push(vzorek(kdy + i * 2000, 130 + (i % 2) * 40));  // hřeben
  body.sort((a, b) => Date.parse(a.kdy) - Date.parse(b.kdy));

  const po = vzorkyPoCase(body, 60);
  ma(body.length === 99, 'na vstupu je 99 vzorků', body.length);
  ma(po.length < 70, 'po sloučení jich je míň než oken', po.length);
  // Žádné dva body nesmí stát na sobě — to je přesně ten hřeben.
  let nejblize = Infinity;
  for (let i = 1; i < po.length; i++) {
    nejblize = Math.min(nejblize, Date.parse(po[i].kdy) - Date.parse(po[i - 1].kdy));
  }
  ma(nejblize >= 10 * 60000, 'žádné dva body nestojí blíž než deset minut',
    Math.round(nejblize / 60000) + ' min (před sloučením 0 min)');
  ma(zuby(po, 'hodnota') < zuby(body, 'hodnota') / 3,
    'zubatost spadla aspoň na třetinu', zuby(body, 'hodnota') + ' → ' + zuby(po, 'hodnota'));
  ma(po[0].kdy === body[0].kdy, 'první vzorek zůstává — popisek „od" na něj ukazuje');
  ma(po[po.length - 1].kdy === body[body.length - 1].kdy, 'a poslední taky — to je dnešek');
}

// ─── 2. Klidná řada se nemá kazit ───────────────────────────────────────────
{
  console.log('\nKlidná řada se nemění');
  const body = [];
  for (let h = 0; h < 40; h++) body.push(vzorek(T0 + h * HOD, 100 + h));
  const po = vzorkyPoCase(body, 60);
  ma(po.length === body.length, 'všechny hodinové vzorky zůstaly', po.length + ' z ' + body.length);
  ma(po[10].hodnota === body[10].hodnota, 'a hodnoty se nepřepočítávají');
}

// ─── 3. Z okna se bere poslední hodnota, ne první ───────────────────────────
{
  console.log('\nV okně rozhoduje poslední hodnota (závěr okna)');
  const body = [vzorek(T0, 10)];
  for (let i = 1; i <= 5; i++) body.push(vzorek(T0 + 60 * HOD + i * 1000, 100 + i));
  body.push(vzorek(T0 + 120 * HOD, 999));
  const po = vzorkyPoCase(body, 60);
  const stred = po.filter((b) => b.hodnota >= 100 && b.hodnota < 999);
  ma(stred.length === 1, 'shluk se slil do jednoho bodu', stred.length);
  ma(stred[0].hodnota === 105, 'a je to ta poslední hodnota', stred[0].hodnota);
}

// ─── 4. Vodorovná osa je čas ────────────────────────────────────────────────
{
  console.log('\nVodorovně se měří čas');
  const body = [vzorek(T0, 1), vzorek(T0 + 1000, 2), vzorek(T0 + 2000, 3), vzorek(T0 + 100 * HOD, 4)];
  const kam = podilCasu(body);
  ma(kam(body[0], 0) === 0, 'první bod je na začátku');
  ma(kam(body[3], 3) === 1, 'poslední na konci');
  ma(kam(body[1], 1) < 0.001, 'bod o vteřinu později je pořád u kraje', kam(body[1], 1).toFixed(5));
  const pulka = podilCasu([vzorek(T0, 1), vzorek(T0 + 50 * HOD, 2), vzorek(T0 + 100 * HOD, 3)]);
  ma(Math.abs(pulka({ kdy: new Date(T0 + 50 * HOD).toISOString() }, 1) - 0.5) < 1e-9,
    'půlka času je půlka grafu');
}

// ─── 5. Nesmysly nic neshodí ────────────────────────────────────────────────
{
  console.log('\nRozbitá data');
  ma(vzorkyPoCase([], 60).length === 0, 'prázdno');
  ma(vzorkyPoCase(null, 60).length === 0, 'null');
  ma(vzorkyPoCase([vzorek(T0, 1), vzorek(T0 + 1000, 2)], 60).length === 2, 'dva body projdou beze změny');
  const stejne = [vzorek(T0, 1), vzorek(T0, 2), vzorek(T0, 3)];
  ma(vzorkyPoCase(stejne, 60).length === 3, 'tři vzorky ve stejnou chvíli se nezahodí');
  const rozbite = [{ kdy: 'nesmysl', hodnota: 1 }, { kdy: 'nesmysl', hodnota: 2 }, { kdy: 'x', hodnota: 3 }];
  ma(vzorkyPoCase(rozbite, 60).length === 3, 'nečitelný čas vrátí vzorky beze změny');
  const kam = podilCasu(rozbite);
  ma(kam(rozbite[1], 1) === 0.5, 'a kreslí se pak podle pořadí', kam(rozbite[1], 1));
}

// ─── 6. Oba grafy to opravdu používají ──────────────────────────────────────
{
  console.log('\nOba grafy kreslí podle času');
  ma(/function fondGraf[\s\S]{0,400}vzorkyPoCase\(body, 60\)/.test(HRA), 'fond slévá vzorky do oken');
  ma(/function fondGraf[\s\S]{0,700}podilCasu\(body\)/.test(HRA), 'a kreslí je podle času');
  ma(/function akcieKrivka[\s\S]{0,400}vzorkyPoCase\(body, maly \? 30 : 60\)/.test(HRA),
    'cena akcie taky — na malé kartě hrubší okna');
  ma(/function akcieKrivka[\s\S]{0,900}podilCasu\(body\)/.test(HRA), 'a taky podle času');
  // Nikde nesmí zbýt stará osa podle pořadí.
  ma(!/var x = function \(i\) \{ return \(i \/ \(body\.length - 1\)\) \* S; \};/.test(HRA),
    'stará osa podle pořadí v kódu nezbyla');
  const osy = (HRA.match(/var x = function \(b, i\) \{ return kam\(b, i\) \* S; \};/g) || []).length;
  ma(osy === 2, 'x bere bod, ne jen jeho pořadí — v obou grafech', osy + ' z 2');
  ma(!/\(i \/ \(body\.length - 1\)\) \* S/.test(HRA), 'a nikde se nepočítá z pořadí v poli');
  // Popisek „od" musí ukazovat na skutečný první vzorek, ne na slitý.
  ma(/datumKratce\(vse\[0\]\.kdy\)/.test(HRA), 'popisek „od" bere první skutečný vzorek');
}

console.log(chyb ? '\n' + chyb + ' CHYB' : '\nVšechno sedí.');
process.exit(chyb ? 1 : 0);
