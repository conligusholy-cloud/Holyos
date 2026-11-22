// =============================================================================
// HolyOS — Laundromat Tycoon: test stropu trvalých kampaní
// =============================================================================
// Návštěvnost násobí tržbu CELÉ sítě, takže je to nejsilnější číslo ve hře.
// Týdenní kampaně se proto nikdy nesčítaly — běží vždycky jedna a další ji
// nahradí. Trvalá karta „Reklamní kampaň" tohle ošetření nikdy nedostala
// a sčítala se bez omezení: třicet karet dělalo návštěvnost 4,50 proti 0,49
// u hráče bez nich, tedy devítinásobnou tržbu z téže sítě.
//
// Strop je šest karet. Test hlídá, že platí na serveru i ve hře — a že karta
// nad strop se nespálí, ale odmítne.
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KOREN = path.join(__dirname, '..');
let chyb = 0;
function ma(podminka, popis, co) {
  if (podminka) { console.log('  ok   ' + popis + (co != null ? '  — ' + co : '')); return; }
  chyb++; console.log('  CHYBA ' + popis + (co != null ? '  — ' + co : ''));
}

// Server: vzorec se pouští opravdový, jen bez databáze.
const zdrojNav = fs.readFileSync(path.join(KOREN, 'services/game/navstevnost.js'), 'utf8');
const ctxS = { module: { exports: {} }, require: (x) => (x === './konjunktura'
  ? { koef: () => 1 } : { prisma: {} }), Math, Number, Date, console };
ctxS.exports = ctxS.module.exports;
vm.createContext(ctxS);
vm.runInContext(zdrojNav, ctxS);
const NAV = ctxS.module.exports;

console.log('\nStrop na serveru');
ma(NAV.BOOST_KARET_MAX === 6, 'strop je šest karet', String(NAV.BOOST_KARET_MAX));
const t = (karet, refs, povest, kampan) => NAV.spocti({ refs, boost: karet * 0.15,
  kampanAdd: kampan || 0, povest }, Date.now());
ma(Math.abs(t(6, 2, 100) - t(30, 2, 100)) < 1e-9, 'třicet karet nedá víc než šest',
  t(30, 2, 100).toFixed(3) + ' = ' + t(6, 2, 100).toFixed(3));
ma(t(3, 2, 100) < t(6, 2, 100), 'pod stropem karta pořád přidává',
  t(3, 2, 100).toFixed(3) + ' < ' + t(6, 2, 100).toFixed(3));
// Hráč, co karty koupil (šest kusů), nesmí stropem ztratit nic.
ma(Math.abs(t(6, 393, 90, 0.25) - 2.4525) < 0.01, 'kdo má šest, má pořád svoje',
  t(6, 393, 90, 0.25).toFixed(4));
// A nejkřiklavější případ: třicet karet proti žádné.
ma(t(30, 2, 100) / t(0, 2, 100) < 3, 'náskok z karet se drží v rozumném poměru',
  (t(30, 2, 100) / t(0, 2, 100)).toFixed(2) + '× (dřív 9,2×)');

console.log('\nStrop ve hře');
const hra = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.js'), 'utf8');
ma(/var BOOST_KARET_MAX = 6;/.test(hra), 'hra zná stejný strop');
ma(/function boostHry\(\) \{ return Math\.min\(BOOST_MAX,/.test(hra), 'a drží ho na jednom místě');
['trafficMax', 'navstevnostBez', 'traffic'].forEach((f) => {
  const i = hra.indexOf('function ' + f + '(');
  const telo = hra.slice(i, i + 400);
  ma(/boostHry\(\)/.test(telo) && !/S\.boost/.test(telo.split('function ')[1] || telo),
    f + '() počítá se stropem');
});
ma(/S\.boost = Math\.min\(BOOST_MAX,/.test(hra), 'použitá karta nad strop stav nenafoukne');

console.log('\nKarta nad strop se nespálí');
const acct = fs.readFileSync(path.join(KOREN, 'routes/game-account.routes.js'), 'utf8');
ma(/uz >= NAV\.BOOST_KARET_MAX/.test(acct), 'server použití odmítne');
ma(/server\.kampani_uz_mas_strop/.test(acct), 'a řekne proč');
['cs', 'en', 'de', 'es', 'fr', 'pl', 'pt'].forEach((j) => {
  const d = JSON.parse(fs.readFileSync(path.join(KOREN, 'services/game/texty/' + j + '.json'), 'utf8'));
  ma(!!d['server.kampani_uz_mas_strop'], j + ': hláška přeložená');
});

console.log(chyb ? '\nNEPROŠLO: ' + chyb + ' chyb' : '\nVšechno sedí.');
process.exit(chyb ? 1 : 0);
