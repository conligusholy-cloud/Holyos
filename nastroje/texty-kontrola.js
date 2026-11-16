#!/usr/bin/env node
// =============================================================================
// Kontrola překladů — co chybí, co zestaralo, kde se zapomnělo na katalog
// =============================================================================
// Pouští se před nasazením. Hlídá tři věci:
//
//  1. Chybějící překlad — klíč je v češtině a v angličtině ne.
//  2. Zastaralý překlad — česká předloha se od posledního překladu změnila.
//     Pozná se podle otisku uloženého v en.meta.json; bez něj by se změna
//     české věty tiše nepromítla a anglická verze by lhala.
//  3. Zapomenutý text — český řetězec přímo v kódu, mimo katalog. Tohle je
//     ta nejdůležitější past: bez téhle kontroly se za měsíc začne zase
//     programovat s textem přivařeným do kódu a celá práce se rozpadne.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KOREN = path.join(__dirname, '..');
const TEXTY = path.join(KOREN, 'services', 'game', 'texty');
const HRA = path.join(KOREN, 'public', 'compounder', 'game', 'game.js');
const CZ = /[ěščřžýáíéúůňťďóĚŠČŘŽÝÁÍÉÚŮŇŤĎÓ]/;

function nacti(jmeno, vychozi) {
  try { return JSON.parse(fs.readFileSync(path.join(TEXTY, jmeno), 'utf8')); }
  catch (e) { return vychozi; }
}
const otisk = (x) => crypto.createHash('sha1')
  .update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 12);

function main() {
  const cs = nacti('cs.json', {});
  const en = nacti('en.json', {});
  const meta = nacti('en.meta.json', {});

  const chybi = [], zastarale = [];
  Object.keys(cs).forEach((k) => {
    if (en[k] == null) { chybi.push(k); return; }
    if (meta[k] && meta[k] !== otisk(cs[k])) zastarale.push(k);
  });

  // Zapomenuté texty v kódu. Počítají se jen celé řetězce s českým písmenem;
  // komentáře se přeskakují, ty jsou pro nás, ne pro hráče.
  const radky = fs.readFileSync(HRA, 'utf8').split('\n');
  const zapomenute = [];
  radky.forEach((l, i) => {
    const bezKomentare = l.replace(/\/\/.*$/, '');
    const re = /'((?:[^'\\\n]|\\.)*)'/g;
    let m;
    while ((m = re.exec(bezKomentare)) !== null) {
      if (m[1] && CZ.test(m[1])) zapomenute.push({ radek: i + 1, text: m[1].slice(0, 60) });
    }
  });

  console.log('klíčů v češtině: ' + Object.keys(cs).length
    + ' · přeloženo: ' + (Object.keys(cs).length - chybi.length)
    + ' · chybí: ' + chybi.length
    + ' · zastaralých: ' + zastarale.length);
  console.log('českých textů přímo v kódu: ' + zapomenute.length);

  if (process.argv.includes('--vypis')) {
    chybi.slice(0, 40).forEach((k) => console.log('  chybí      ' + k));
    zastarale.forEach((k) => console.log('  zastaralé  ' + k));
    zapomenute.slice(0, 40).forEach((z) => console.log('  v kódu  ř.' + z.radek + '  ' + z.text));
  }

  // Nasazení se kvůli překladům nezastavuje — tak to bylo rozhodnuto.
  // Návratový kód jen říká, jestli je co dopřekládat, aby se na to dal
  // pověsit automatický překlad.
  process.exit(chybi.length || zastarale.length ? 1 : 0);
}
main();
