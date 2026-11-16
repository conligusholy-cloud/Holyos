#!/usr/bin/env node
// =============================================================================
// Doručenky: česká věta → kód a údaje
// =============================================================================
// Doručenka je zpráva o penězích nebo majetku a leží v databázi, dokud si ji
// hráč nevyzvedne. Když se do ní uloží hotová česká věta, přečte ji tak i
// hráč, co má nastavenou angličtinu — a zpětně se s tím nedá nic dělat.
//
// Tenhle nástroj u každé doručenky přidá text_kod a text_data vedle popisu.
// popis zůstává a plní se dál česky: je to záloha pro případ, že klíč
// v katalogu chybí, a pro řádky, co v databázi už jsou.
//
//   popis: 'Koupil jsi ' + popisPredmetu
//   → popis: 'Koupil jsi ' + popisPredmetu,
//     text_kod: 'dor.koupil_jsi', text_data: { p1: popisPredmetu }
'use strict';
const fs = require('fs');
const path = require('path');
const CZ = /[ěščřžýáíéúůňťďóĚŠČŘŽÝÁÍÉÚŮŇŤĎÓ]/;
const CS = path.join(__dirname, '..', 'services', 'game', 'texty', 'cs.json');

// Najde konec výrazu za 'popis:' — řetěz spojený plusem, končí čárkou nebo
// uzavírací závorkou na nulové hloubce.
function konecVyrazu(txt, od) {
  let i = od, h = 0;
  while (i < txt.length) {
    const z = txt[i];
    if (z === "'") { let j = i + 1; while (j < txt.length && (txt[j] !== "'" || txt[j - 1] === '\\')) j++; i = j + 1; continue; }
    if (z === '(' || z === '[' || z === '{') h++;
    else if (z === ')' || z === ']' || z === '}') { if (h === 0) return i; h--; }
    else if (h === 0 && z === ',') return i;
    i++;
  }
  return i;
}

function cleny(vyraz) {
  const out = []; let i = 0, h = 0, od = 0;
  const push = (do_) => { const c = vyraz.slice(od, do_).trim(); if (c) out.push(c); };
  while (i < vyraz.length) {
    const z = vyraz[i];
    if (z === "'") { let j = i + 1; while (j < vyraz.length && (vyraz[j] !== "'" || vyraz[j - 1] === '\\')) j++; i = j + 1; continue; }
    if (z === '(' || z === '[' || z === '{') h++;
    if (z === ')' || z === ']' || z === '}') h--;
    if (h === 0 && z === '+') { push(i); od = i + 1; }
    i++;
  }
  push(vyraz.length);
  return out;
}

function klicZ(t, p, obsazene) {
  let z = t.replace(/\{[^}]*\}/g, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  z = z.split('_').filter(Boolean).slice(0, 5).join('_') || 'zprava';
  let k = p + '.' + z, i = 2;
  while (obsazene.has(k)) { k = p + '.' + z + '_' + i; i++; }
  obsazene.add(k);
  return k;
}

function main() {
  const [soubor, prepinac] = process.argv.slice(2);
  if (!soubor) { console.error('použití: <soubor> [--zapsat]'); process.exit(1); }
  const cesta = path.join(__dirname, '..', soubor);
  let txt = fs.readFileSync(cesta, 'utf8');
  const cs = JSON.parse(fs.readFileSync(CS, 'utf8'));
  const obsazene = new Set(Object.keys(cs));
  const nove = {}; const vynechane = [];

  // Odzadu, ať se indexy neposunou.
  const mista = [];
  const re = /popis:\s/g; let m;
  while ((m = re.exec(txt)) !== null) mista.push(m.index + m[0].length);
  mista.reverse().forEach((od) => {
    const konec = konecVyrazu(txt, od);
    const vyraz = txt.slice(od, konec).trim();
    if (!CZ.test(vyraz)) return;
    if (/text_kod/.test(vyraz)) return;
    const c = cleny(vyraz);
    if (!c.length || !c.some((x) => x[0] === "'" && CZ.test(x))) return;
    // Podmínka uvnitř → dvě různé věty, na to ruku.
    if (c.some((x) => x[0] !== "'" && /[?:]/.test(x))) { vynechane.push(vyraz.slice(0, 60)); return; }
    let sablona = '', udaje = [], n = 0;
    c.forEach((x) => {
      if (x[0] === "'") { sablona += x.slice(1, -1); return; }
      n++; udaje.push('p' + n + ': ' + x); sablona += '{p' + n + '}';
    });
    if (sablona.indexOf("\\'") >= 0) { vynechane.push(sablona.slice(0, 60)); return; }
    // Stejná věta = stejný klíč. „Vydražil jsi {p1}" je na třech místech
    // a tři klíče na jeden text by znamenaly tři překlady, co se můžou
    // rozejít.
    let k = Object.keys(nove).find((x) => nove[x] === sablona)
      || Object.keys(cs).find((x) => cs[x] === sablona && x.startsWith('dor.'));
    if (!k) { k = klicZ(sablona, 'dor', obsazene); nove[k] = sablona; }
    const vlozit = ", text_kod: '" + k + "'"
      + (udaje.length ? ', text_data: { ' + udaje.join(', ') + ' }' : '');
    txt = txt.slice(0, konec) + vlozit + txt.slice(konec);
  });

  console.log(soubor + ' · doručenek: ' + Object.keys(nove).length
    + (vynechane.length ? ' · k ruce: ' + vynechane.length : ''));
  Object.keys(nove).slice(0, 6).forEach((k) => console.log('  ' + k.padEnd(34) + ' = ' + nove[k].slice(0, 58)));
  if (prepinac !== '--zapsat') { console.log('(nanečisto)'); return; }
  Object.assign(cs, nove);
  fs.writeFileSync(CS, JSON.stringify(cs, null, 2) + '\n', 'utf8');
  fs.writeFileSync(cesta, txt, 'utf8');
  console.log('zapsáno.');
}
main();
