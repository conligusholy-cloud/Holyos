// =============================================================================
// Vložení ručně přeložených textů do katalogu
// =============================================================================
// Automatický překlad (texty-prelozit.js) potřebuje klíč k API. Když ho není
// kde vzít — nebo když se nějaký text překládá ručně, protože se automatu
// nepovedl — tohle vezme soubor { "klic": "text" } a zapíše ho do katalogu
// i s otiskem české předlohy, aby kontrola věděla, že překlad není zastaralý.
//
//   node nastroje/texty-vlozit.js --jazyk=it davka.json
//   node nastroje/texty-vlozit.js --jazyk=it davka.json --prepsat   (i hotové)
//
// Co není v češtině, se odmítne: překlep v klíči by jinak založil text, který
// hra nikdy nepoužije, a kontrola by ho hlásila jako zastaralý navždycky.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KOREN = path.join(__dirname, '..', 'services', 'game', 'texty');
const cesta = (f) => path.join(KOREN, f);
const otisk = (x) => crypto.createHash('sha1').update(String(x), 'utf8').digest('hex').slice(0, 12);
const nacti = (f, vych) => { try { return JSON.parse(fs.readFileSync(cesta(f), 'utf8')); } catch (e) { return vych; } };
const uloz = (f, o) => fs.writeFileSync(cesta(f),
  JSON.stringify(Object.keys(o).sort().reduce((a, k) => (a[k] = o[k], a), {}), null, 2) + '\n');

function main() {
  const jazyk = (process.argv.find((a) => a.startsWith('--jazyk=')) || '').split('=')[1];
  const soubor = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const prepsat = process.argv.includes('--prepsat');
  if (!jazyk || !soubor) {
    console.error('Použití: node nastroje/texty-vlozit.js --jazyk=it davka.json [--prepsat]');
    process.exit(1);
  }
  let davka;
  try { davka = JSON.parse(fs.readFileSync(soubor, 'utf8')); }
  catch (e) { console.error('Soubor ' + soubor + ' nejde přečíst: ' + e.message); process.exit(1); }

  const cs = nacti('cs.json', {});
  const cil = nacti(jazyk + '.json', {});
  const meta = nacti(jazyk + '.meta.json', {});
  let zapsano = 0, preskoceno = 0;
  const nezname = [], tvaryChybi = [];
  Object.keys(davka).forEach((k) => {
    if (cs[k] == null) { nezname.push(k); return; }
    if (cil[k] != null && !prepsat) { preskoceno++; return; }
    // Tvary množného čísla: co je v předloze objekt, musí být objekt i tady.
    // Obyčejný text by se ve větě ukázal jako [object Object].
    const predlohaObjekt = typeof cs[k] === 'object';
    const prekladObjekt = typeof davka[k] === 'object';
    if (predlohaObjekt !== prekladObjekt) { tvaryChybi.push(k); return; }
    cil[k] = davka[k];
    meta[k] = otisk(typeof cs[k] === 'object' ? JSON.stringify(cs[k]) : cs[k]);
    zapsano++;
  });
  uloz(jazyk + '.json', cil);
  uloz(jazyk + '.meta.json', meta);
  console.log('zapsáno ' + zapsano + (preskoceno ? ', přeskočeno hotových ' + preskoceno : ''));
  if (nezname.length) console.log('NEZNÁMÉ klíče (nejsou v cs.json), nezapsáno: ' + nezname.join(', '));
  if (tvaryChybi.length) console.log('ŠPATNÝ TVAR (objekt vs. text), nezapsáno: ' + tvaryChybi.join(', '));
  const chybi = Object.keys(cs).filter((k) => cil[k] == null).length;
  console.log('hotovo ' + (Object.keys(cs).length - chybi) + ' z ' + Object.keys(cs).length
    + ', chybí ' + chybi);
}

main();
