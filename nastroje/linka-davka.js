#!/usr/bin/env node
// =============================================================================
// Laundromat Tycoon — výpis scénářů infolinky k ručnímu překladu
// =============================================================================
// Vypíše na stdout další scénáře, které v cílovém jazyce ještě nejsou,
// jako pole JSON. Počet scénářů se řídí --kolik.
//
//   node nastroje/linka-davka.js --jazyk=it --kolik=5

'use strict';

const fs = require('fs');
const path = require('path');
const TEXTY = path.join(__dirname, '..', 'services', 'game', 'texty');
const nacti = (f, v) => { try { return JSON.parse(fs.readFileSync(path.join(TEXTY, f), 'utf8')); } catch (e) { return v; } };

const argv = process.argv.slice(2);
const jazyk = (argv.find((a) => a.startsWith('--jazyk=')) || '').slice(8);
const kolik = Number((argv.find((a) => a.startsWith('--kolik=')) || '--kolik=5').slice(8)) || 5;
if (!jazyk) { console.error('použití: node nastroje/linka-davka.js --jazyk=it --kolik=5'); process.exit(1); }

const cs = nacti('linka.cs.json', []);
const hotove = new Set((nacti('linka.' + jazyk + '.json', []) || []).filter((x) => x && x.id).map((x) => x.id));
const chybi = cs.filter((s) => !hotove.has(s.id));
console.error('chybí ' + chybi.length + ' z ' + cs.length);
console.log(JSON.stringify(chybi.slice(0, kolik), null, 1));
