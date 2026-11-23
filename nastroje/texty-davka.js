// Vypíše další dávku textů, které v cílovém jazyce chybí — jako JSON
// { klic: text }. Slouží k ručnímu překladu po částech.
//   node nastroje/texty-davka.js --jazyk=it --kolik=150 [--od=0]
'use strict';
const fs = require('fs');
const path = require('path');
const KOREN = path.join(__dirname, '..', 'services', 'game', 'texty');
const nacti = (f, v) => { try { return JSON.parse(fs.readFileSync(path.join(KOREN, f), 'utf8')); } catch (e) { return v; } };
const arg = (n, v) => { const a = process.argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : v; };
const jazyk = arg('jazyk', 'it');
const kolik = parseInt(arg('kolik', '150'), 10);
const od = parseInt(arg('od', '0'), 10);
const cs = nacti('cs.json', {});
const cil = nacti(jazyk + '.json', {});
const chybi = Object.keys(cs).filter((k) => cil[k] == null);
const vyber = chybi.slice(od, od + kolik);
const ven = {};
vyber.forEach((k) => { ven[k] = cs[k]; });
console.log(JSON.stringify(ven, null, 1));
console.error('chybí celkem ' + chybi.length + ', vypsáno ' + vyber.length);
