// =============================================================================
// HolyOS — Laundromat Tycoon: test nepřevoditelné uvítací karty
// =============================================================================
// Každý nový účet dostane jednu kartu od každého druhu zdarma — včetně karty
// na návštěvnost, která natrvalo násobí tržbu CELÉ sítě. Dokud se dala
// převést, stačilo založit účet, vybrat ji a poslat hlavnímu: jeden hráč si
// takhle nasbíral třicet karet a vydělával desetinásobek.
//
// Uvítací karta se proto nepřevádí. Test hlídá, že se na to nezapomnělo ani
// v jednom ze šesti míst, kudy karta může změnit majitele.
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const KOREN = path.join(__dirname, '..');
let chyb = 0;
function ma(podminka, popis, co) {
  if (podminka) { console.log('  ok   ' + popis + (co != null ? '  — ' + co : '')); return; }
  chyb++; console.log('  CHYBA ' + popis + (co != null ? '  — ' + co : ''));
}

const trade = fs.readFileSync(path.join(KOREN, 'routes/game-trade.routes.js'), 'utf8');
const acct = fs.readFileSync(path.join(KOREN, 'routes/game-account.routes.js'), 'utf8');
const hra = fs.readFileSync(path.join(KOREN, 'public/compounder/game/game.js'), 'utf8');
const schema = fs.readFileSync(path.join(KOREN, 'prisma/schema.prisma'), 'utf8');

console.log('\nZnačka v databázi');
ma(/puvod {7}String\? {3}@db\.VarChar\(16\)/.test(schema), 'karta má sloupec puvod');
const migr = fs.readdirSync(path.join(KOREN, 'prisma/migrations'))
  .filter((d) => /karta_puvod/.test(d));
ma(migr.length === 1, 'migrace sloupec přidává', migr.join(', '));
const sql = fs.readFileSync(path.join(KOREN, 'prisma/migrations/' + migr[0] + '/migration.sql'), 'utf8');
ma(/ADD COLUMN IF NOT EXISTS "puvod"/.test(sql), 'sloupec se přidává bezpečně');
ma(/UPDATE "game_cards"[\s\S]*'uvitaci'/.test(sql), 'a staré uvítací karty se dohledají zpětně');

console.log('\nUvítací karty se značkou vznikají');
const uvitaci = acct.match(/kind: k, puvod: 'uvitaci'/g) || [];
ma(uvitaci.length === 2, 'obě místa, kde se balíček rozdává, kartu značí',
  uvitaci.length + ' z 2');

console.log('\nŠest míst, kudy karta mění majitele');
// Každé z nich musí mít v podmínce puvod: null — tedy „jen karty, které
// uvítací nejsou".
const mista = [
  ['nabídka: prodávající kartu má', /kind: nab\.card_kind \|\| '', used_at: null, puvod: null/],
  ['karty přihozené k ceně', /player_id: platici\.id, kind: k,\s*\n\s*used_at: null, puvod: null/],
  ['převod přihozených karet', /player_id: kupujici\.id, kind: k,\s*\n\s*used_at: null, puvod: null/],
  ['převod prodané karty', /kind: t\.card_kind, used_at: null, puvod: null/],
  ['vyvěšení dražby', /player_id: ja\.id, kind: cardKind,\s*\n\s*used_at: null, puvod: null/],
  ['převod vydražené karty', /kind: d\.card_kind, used_at: null, puvod: null/],
];
mista.forEach(([popis, re]) => ma(re.test(trade), popis));
ma((trade.match(/puvod: null/g) || []).length === 6, 'a nikde jinde se to neřeší',
  (trade.match(/puvod: null/g) || []).length + '× puvod: null');

console.log('\nHráč se dozví proč');
ma(/server\.uvitaci_karta_se_neprevadi/.test(trade), 'hláška má vlastní text');
ma((trade.match(/uvitaci_karta_se_neprevadi/g) || []).length === 2,
  'a to u nabídky i u dražby');
['cs', 'en', 'de', 'es', 'fr', 'pl', 'pt'].forEach((j) => {
  const d = JSON.parse(fs.readFileSync(path.join(KOREN, 'services/game/texty/' + j + '.json'), 'utf8'));
  ma(!!d['server.uvitaci_karta_se_neprevadi'], j + ': text přeložený');
});

console.log('\nHra nenabízí k prodeji, co se nepřevede');
ma(/cards_prevod: prevod/.test(acct), 'server posílá počet převoditelných karet');
ma(/c\.puvod !== 'uvitaci'/.test(acct), 'a uvítací do něj nepočítá');
ma(/function prevoditelnychKaret/.test(hra), 'hra se podle toho řídí');
ma((hra.match(/prevoditelnychKaret\(c\.kind\)/g) || []).length === 2,
  'v obchodu i v dražbě', (hra.match(/prevoditelnychKaret\(c\.kind\)/g) || []).length + ' z 2');

console.log(chyb ? '\nNEPROŠLO: ' + chyb + ' chyb' : '\nVšechno sedí.');
process.exit(chyb ? 1 : 0);
