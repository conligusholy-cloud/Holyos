#!/usr/bin/env node
// =============================================================================
// Laundromat Tycoon — vložení ručně přeložených scénářů infolinky
// =============================================================================
// Sourozenec texty-vlozit.js, jen pro linku. Bere soubor s polem scénářů
// a vloží je do linka.<jazyk>.json. Páruje podle id, pořadí drží podle
// české předlohy a otisk zapisuje stejně jako automatický překlad, aby
// texty-prelozit.js hotové scénáře nepřekládal znovu.
//
// Hlídá stavbu: id musí existovat v předloze, počet kroků i odpovědí musí
// sedět a b s rodem musí zůstat beze změny — podle nich hra hovor řídí.
// Když to nesedí, nezapíše se nic.
//
//   node nastroje/linka-vlozit.js --jazyk=it davka.json [--prepsat]

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEXTY = path.join(__dirname, '..', 'services', 'game', 'texty');
const otisk = (x) => crypto.createHash('sha1')
  .update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 12);
const cesta = (f) => path.join(TEXTY, f);
const nacti = (f, v) => { try { return JSON.parse(fs.readFileSync(cesta(f), 'utf8')); } catch (e) { return v; } };
const zapis = (f, o) => fs.writeFileSync(cesta(f), JSON.stringify(o, null, 2) + '\n', 'utf8');

const argv = process.argv.slice(2);
const jazyk = (argv.find((a) => a.startsWith('--jazyk=')) || '').slice(8);
const prepsat = argv.includes('--prepsat');
const soubor = argv.find((a) => !a.startsWith('--'));
if (!jazyk || !soubor) {
  console.error('použití: node nastroje/linka-vlozit.js --jazyk=it davka.json [--prepsat]');
  process.exit(1);
}

const cs = nacti('linka.cs.json', null);
if (!cs) { console.error('linka.cs.json nenalezena'); process.exit(1); }
const predloha = new Map(cs.map((s) => [s.id, s]));

const davka = JSON.parse(fs.readFileSync(soubor, 'utf8'));
if (!Array.isArray(davka)) { console.error('dávka musí být pole scénářů'); process.exit(1); }

const souborJ = 'linka.' + jazyk + '.json';
const souborM = 'linka.' + jazyk + '.meta.json';
const hotove = nacti(souborJ, []);
const meta = nacti(souborM, {});
const podleId = new Map(hotove.filter((x) => x && x.id != null).map((x) => [x.id, x]));

const chyby = [];
for (const s of davka) {
  const p = s && predloha.get(s && s.id);
  if (!p) { chyby.push('neznámé id: ' + (s && s.id)); continue; }
  if (podleId.has(s.id) && !prepsat) { chyby.push(s.id + ': už je přeložený (--prepsat)'); continue; }
  if ((s.rod || '') !== (p.rod || '')) chyby.push(s.id + ': změněný rod');
  if (!Array.isArray(s.kroky) || s.kroky.length !== p.kroky.length) {
    chyby.push(s.id + ': jiný počet kroků'); continue;
  }
  p.kroky.forEach((kp, i) => {
    const ks = s.kroky[i];
    if (!ks || typeof ks.t !== 'string' || !ks.t.trim()) { chyby.push(s.id + ' krok ' + (i + 1) + ': chybí t'); return; }
    if (!Array.isArray(ks.o) || ks.o.length !== kp.o.length) { chyby.push(s.id + ' krok ' + (i + 1) + ': jiný počet odpovědí'); return; }
    kp.o.forEach((op, j) => {
      const os = ks.o[j];
      if (!os || typeof os.t !== 'string' || typeof os.r !== 'string' || !os.t.trim() || !os.r.trim()) {
        chyby.push(s.id + ' krok ' + (i + 1) + ' odpověď ' + (j + 1) + ': chybí t nebo r');
      } else if (os.b !== op.b) {
        chyby.push(s.id + ' krok ' + (i + 1) + ' odpověď ' + (j + 1) + ': změněné b (' + op.b + ' → ' + os.b + ')');
      }
    });
  });
}
if (chyby.length) {
  console.error('nic jsem nezapsal, nesedí stavba:');
  chyby.slice(0, 40).forEach((c) => console.error('  ' + c));
  if (chyby.length > 40) console.error('  … a dalších ' + (chyby.length - 40));
  process.exit(1);
}

for (const s of davka) {
  podleId.set(s.id, s);
  meta[s.id] = otisk(predloha.get(s.id));
}
zapis(souborJ, cs.map((s) => podleId.get(s.id)).filter(Boolean));
zapis(souborM, meta);
console.log('zapsáno ' + davka.length);
console.log('hotovo ' + podleId.size + ' z ' + cs.length + ', chybí ' + (cs.length - podleId.size));
