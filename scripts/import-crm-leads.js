// =============================================================================
// HolyOS — Import leadů z předchozího CRM do tabulky crm_leads
// =============================================================================
// Načte CSV export, vyřadí smazané, normalizuje kontakt, DEDUPLIKUJE (telefon /
// e-mail) a informačně sloučí duplicity do jednoho záznamu (dup_count + spojené
// poznámky), namapuje segment ze stavu a naplní tabulku crm_leads.
//
// Spuštění (lokálně proti Railway DB — DATABASE_URL v .env):
//   node scripts/import-crm-leads.js "C:\\cesta\\Obchodní příležitosti.csv"
//   node scripts/import-crm-leads.js "..." --keep   (nemazat stávající, jen doplnit)
//
// Bez --keep se tabulka před importem vyprázdní (čistý re-import).

'use strict';

const fs = require('fs');
const path = require('path');
// Když DATABASE_URL chybí/není platná v prostředí, načti ji z .env (aby šel skript
// spustit ručně bez exportu). MUSÍ být před require('../config/database').
if (!process.env.DATABASE_URL || !/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL)) {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const m = t.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) process.env.DATABASE_URL = m[1].trim();
  } catch (e) { /* .env nemusí existovat */ }
}
const { prisma } = require('../config/database');

// ─── Minimální CSV parser (RFC 4180: uvozovky, "" escape, čárky/nové řádky uvnitř) ──
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inq = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inq) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inq = false; }
      } else { field += c; }
    } else if (c === '"') {
      inq = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = ''; rows.push(row); row = [];
    } else if (c === '\r') {
      // ignoruj, \n řádek uzavře
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const SEG = {
  'Podepsáná SML': 'smlouva',
  'Má zájem': 'horky', 'Domluvena schůzka': 'horky', 'Domluvená online schůzka': 'horky',
  'Mám volat příště': 'volat',
  'Nedovoláno': 'nedovolano',
  'Nový': 'novy',
  'Nemá zájem': 'nezajem', 'Nelze použít': 'nezajem', 'Zrušeno': 'nezajem',
};
const SEG_PRIO = { smlouva: 0, horky: 1, volat: 2, nedovolano: 3, novy: 4, nezajem: 5, ostatni: 6 };

function segOf(stav) { return SEG[(stav || '').trim()] || 'ostatni'; }
function tel9(s) { const d = String(s || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; }
function trimTo(s, n) { s = (s == null ? '' : String(s)).trim(); return s.length > n ? s.slice(0, n) : s; }
function parseDate(s) { const d = new Date(String(s || '').trim()); return isNaN(d.getTime()) ? null : d; }

async function main() {
  const file = process.argv[2];
  const keep = process.argv.includes('--keep');
  if (!file) { console.error('Použití: node scripts/import-crm-leads.js "cesta/soubor.csv" [--keep]'); process.exit(1); }
  if (!fs.existsSync(file)) { console.error('Soubor nenalezen:', file); process.exit(1); }

  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM
  const rows = parseCsv(text);
  if (!rows.length) { console.error('Prázdný soubor.'); process.exit(1); }

  const header = rows[0].map((h) => h.trim());
  const idx = {};
  header.forEach((h, i) => { if (!(h in idx)) idx[h] = i; }); // první výskyt názvu
  const need = ['Stav', 'Typ', 'Jméno', 'Přijímení', 'Email', 'Telefon', 'Město', 'Země', 'INFO - reklama', 'Poznámka spolupráce', 'Vytvořeno'];
  for (const c of need) if (!(c in idx)) console.warn('POZOR: chybí sloupec "' + c + '" — bude prázdný.');
  const G = (r, name) => { const i = idx[name]; return i == null ? '' : (r[i] == null ? '' : String(r[i]).trim()); };

  // ─── Deduplikace + sloučení ───
  const groups = new Map();
  let considered = 0, skippedDeleted = 0, noKey = 0;
  for (let ri = 1; ri < rows.length; ri++) {
    const r = rows[ri];
    if (!r || r.length < 3) continue;
    const stav = G(r, 'Stav'); const typ = G(r, 'Typ');
    if (stav === 'Smazáno' || typ === 'Smazáno') { skippedDeleted++; continue; }
    considered++;
    const email = G(r, 'Email'); const phone = G(r, 'Telefon');
    const t = tel9(phone); const em = email.toLowerCase();
    let key;
    if (t) key = 't:' + t; else if (em) key = 'e:' + em; else { key = 'r:' + ri; noKey++; }
    const rec = {
      first_name: G(r, 'Jméno'), last_name: G(r, 'Přijímení'),
      email, phone, city: G(r, 'Město'), country: G(r, 'Země'),
      status: stav, segment: segOf(stav), owner_name: typ,
      source: G(r, 'INFO - reklama'), note: G(r, 'Poznámka spolupráce'),
      crm_created_at: G(r, 'Vytvořeno'),
    };
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  }

  // Sestav finální záznamy
  const finalRecs = [];
  for (const [key, arr] of groups) {
    arr.sort((a, b) => {
      const pa = SEG_PRIO[a.segment], pb = SEG_PRIO[b.segment];
      if (pa !== pb) return pa - pb;
      return String(a.crm_created_at).localeCompare(String(b.crm_created_at));
    });
    const primary = arr[0];
    const notes = [];
    for (const x of arr) { const n = (x.note || '').trim(); if (n && !notes.includes(n)) notes.push(n); }
    const email = (arr.find((x) => x.email) || {}).email || '';
    const phone = (arr.find((x) => x.phone) || {}).phone || '';
    const crmDates = arr.map((x) => x.crm_created_at).filter(Boolean).sort();
    finalRecs.push({
      dedup_key: trimTo(key, 140),
      first_name: trimTo(primary.first_name, 200) || null,
      last_name: trimTo(primary.last_name, 200) || null,
      email: trimTo(email, 255) || null,
      phone: trimTo(phone, 60) || null,
      city: trimTo(primary.city, 200) || null,
      country: trimTo(primary.country, 120) || null,
      status: trimTo(primary.status, 60) || null,
      segment: primary.segment,
      contactable: !!(email || phone),
      owner_name: trimTo(primary.owner_name, 200) || null,
      source: trimTo(primary.source, 300) || null,
      note: trimTo(notes.join(' | '), 4000) || null,
      dup_count: arr.length - 1,
      crm_created_at: parseDate(crmDates[0]),
    });
  }

  console.log('Zpracováno řádků:', considered, '| vyřazeno smazaných:', skippedDeleted, '| bez klíče (unik.):', noKey);
  console.log('Unikátních záznamů po sloučení:', finalRecs.length, '| sloučeno duplicit:', considered - finalRecs.length);
  const bySeg = {}; finalRecs.forEach((r) => { bySeg[r.segment] = (bySeg[r.segment] || 0) + 1; });
  console.log('Segmenty:', bySeg);

  if (!keep) {
    const del = await prisma.crmLead.deleteMany({});
    console.log('Vyprázdněno crm_leads:', del.count, '(re-import). Pro doplnění bez mazání použij --keep.');
  }

  // Vlož po dávkách. Při --keep přeskoč duplicitní klíče.
  const BATCH = 1000; let inserted = 0;
  for (let i = 0; i < finalRecs.length; i += BATCH) {
    const chunk = finalRecs.slice(i, i + BATCH);
    const res = await prisma.crmLead.createMany({ data: chunk, skipDuplicates: true });
    inserted += res.count;
    process.stdout.write('\rVkládám… ' + inserted + '/' + finalRecs.length);
  }
  console.log('\nHotovo. Vloženo:', inserted, 'záznamů do crm_leads.');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error('CHYBA importu:', e); try { await prisma.$disconnect(); } catch (_) {} process.exit(1); });
