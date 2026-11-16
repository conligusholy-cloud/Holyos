#!/usr/bin/env node
// =============================================================================
// Vytažení serverových hlášek do katalogu
// =============================================================================
// Hlášky typu res.status(409).json({ error: 'Ten podíl nedržíš.' }) se musí
// skládat v jazyce PŘÍJEMCE, ne v jazyce toho, kdo akci vyvolal. V obsluze je
// k dispozici req, takže se na místo dosadí stx(req)('klic').
//
// Bere jen hlášky uvnitř obsluh, kde je req doopravdy po ruce. Pomocné funkce
// bez req nechává být a nahlásí je — tam se jazyk musí propašovat parametrem
// a to je na ruční rozhodnutí.
'use strict';
const fs = require('fs');
const path = require('path');
const CZ = /[ěščřžýáíéúůňťďóĚŠČŘŽÝÁÍÉÚŮŇŤĎÓ]/;
const CS = path.join(__dirname, '..', 'services', 'game', 'texty', 'cs.json');

function klicZ(text, predpona, obsazene) {
  let z = text.replace(/\{[^}]*\}/g, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  z = z.split('_').filter(Boolean).slice(0, 6).join('_') || 'hlaska';
  let k = predpona + '.' + z, i = 2;
  while (obsazene.has(k)) { k = predpona + '.' + z + '_' + i; i++; }
  obsazene.add(k);
  return k;
}

function main() {
  const [soubor, predpona, prepinac] = process.argv.slice(2);
  if (!soubor || !predpona) { console.error('použití: <soubor> <predpona> [--zapsat]'); process.exit(1); }
  const cesta = path.join(__dirname, '..', soubor);
  let txt = fs.readFileSync(cesta, 'utf8');
  const cs = JSON.parse(fs.readFileSync(CS, 'utf8'));
  const obsazene = new Set(Object.keys(cs));
  const nove = {};
  const vynechane = [];

  // error: 'text'  — jen samostatný literál, nic slepeného.
  txt = txt.replace(/error: '((?:[^'\\\n]|\\.)*)'/g, (cele, obsah) => {
    if (!CZ.test(obsah)) return cele;
    if (/\\'/.test(obsah)) { vynechane.push(obsah.slice(0, 60)); return cele; }
    const k = klicZ(obsah, predpona, obsazene);
    nove[k] = obsah;
    return "error: stx(req)('" + k + "')";
  });

  console.log(soubor + ' · hlášek: ' + Object.keys(nove).length
    + (vynechane.length ? ' · k ruce: ' + vynechane.length : ''));
  Object.keys(nove).slice(0, 5).forEach((k) => console.log('  ' + k.padEnd(40) + ' = ' + nove[k].slice(0, 56)));
  if (prepinac !== '--zapsat') { console.log('(nanečisto)'); return; }
  Object.assign(cs, nove);
  fs.writeFileSync(CS, JSON.stringify(cs, null, 2) + '\n', 'utf8');
  fs.writeFileSync(cesta, txt, 'utf8');
  console.log('zapsáno.');
}
main();
