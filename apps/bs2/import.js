// BS2 — import podporovatelů z CSV / XLSX (SheetJS). Rozpoznání sloupců podle hlavičky,
// e-mail = klíč (lowercase). Ostatní sloupce → extra (JSONB). Upsert: nikdy nepřepíše nick/heslo/status.

const XLSX = require('xlsx');
const { q } = require('./db');

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Najde sloupce podle (diakritiky zbavené) hlavičky
function detectColumns(headers) {
  const map = { email: null, first_name: null, last_name: null, full_name: null };
  for (const h of headers) {
    const n = norm(h);
    if (!map.email && /(^|\s)(e ?mail|email|mail)(\s|$)/.test(n)) map.email = h;
    else if (!map.full_name && /(jmeno a prijmeni|prijmeni a jmeno|cele jmeno|full ?name)/.test(n)) map.full_name = h;
    else if (!map.last_name && /(prijmeni|surname|last ?name|lastname)/.test(n)) map.last_name = h;
    else if (!map.first_name && /(krestni|first ?name|firstname|^jmeno$)/.test(n)) map.first_name = h;
    else if (!map.full_name && /(^|\s)name(\s|$)/.test(n) && !/user|nick|login|firm|company/.test(n)) map.full_name = h;
  }
  // „Jméno" bez „Příjmení" v tabulce = nejspíš celé jméno
  if (map.first_name && !map.last_name && !map.full_name) { map.full_name = map.first_name; map.first_name = null; }
  return map;
}

function splitFullName(v) {
  const parts = String(v || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: null, last_name: null };
  if (parts.length === 1) return { first_name: null, last_name: parts[0] };
  // „Příjmení Jméno" vs „Jméno Příjmení" — bereme poslední slovo jako příjmení (české jméno obvykle první)
  return { first_name: parts.slice(0, -1).join(' '), last_name: parts[parts.length - 1] };
}

function parseBuffer(buf, filename) {
  const isCsv = /\.csv$/i.test(filename || '');
  let wb;
  if (isCsv) {
    // CSV: zkus UTF-8, pak cp1250 (starší exporty z Excelu v CZ)
    let text = buf.toString('utf8');
    if (text.includes('�')) { try { text = new TextDecoder('windows-1250').decode(buf); } catch (e) { /* ponech utf8 */ } }
    text = text.replace(/^﻿/, '');
    const delim = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    wb = XLSX.read(text, { type: 'string', FS: delim, raw: false });
  } else {
    wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { rows, headers };
}

/**
 * @returns {Promise<{file, rows, created, updated, skipped, errors[], map, extraCols[]}>}
 */
async function importSupporters(buf, filename, { dry = false } = {}) {
  const { rows, headers } = parseBuffer(buf, filename);
  const map = detectColumns(headers);
  const result = { file: filename, rows: rows.length, created: 0, updated: 0, skipped: 0, errors: [], map, extraCols: [] };
  if (!rows.length) { result.errors.push('Soubor neobsahuje žádné řádky.'); return result; }
  if (!map.email) {
    // fallback: sloupec, kde většina hodnot vypadá jako e-mail
    for (const h of headers) { const hits = rows.slice(0, 50).filter(r => EMAIL_RE.test(String(r[h] || '').trim())).length; if (hits >= Math.min(rows.length, 50) * 0.5) { map.email = h; break; } }
  }
  if (!map.email) { result.errors.push('Nenašel jsem sloupec s e-mailem (hlavička „E-mail" / „Email" ani sloupec s e-mailovými hodnotami).'); return result; }
  const used = new Set([map.email, map.first_name, map.last_name, map.full_name].filter(Boolean));
  result.extraCols = headers.filter(h => !used.has(h) && String(h).trim() && !/^__EMPTY/.test(h));

  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const email = String(r[map.email] || '').trim().toLowerCase();
    if (!email) { result.skipped++; continue; }
    if (!EMAIL_RE.test(email)) { result.skipped++; result.errors.push(`Řádek ${i + 2}: neplatný e-mail „${email}"`); continue; }
    if (seen.has(email)) { result.errors.push(`Řádek ${i + 2}: duplicitní e-mail ${email} (použit první výskyt)`); continue; }
    seen.add(email);
    let first_name = map.first_name ? String(r[map.first_name] || '').trim() || null : null;
    let last_name = map.last_name ? String(r[map.last_name] || '').trim() || null : null;
    if (map.full_name && (!first_name || !last_name)) { const sp = splitFullName(r[map.full_name]); first_name = first_name || sp.first_name; last_name = last_name || sp.last_name; }
    const extra = {};
    for (const h of result.extraCols) { const v = r[h]; if (v !== '' && v != null) extra[String(h).trim()] = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim(); }

    if (dry) { result.created++; continue; }
    try {
      const up = await q(`
        INSERT INTO supporters (email, first_name, last_name, extra, source, imported_at)
        VALUES ($1, $2, $3, $4::jsonb, $5, now())
        ON CONFLICT (email) DO UPDATE SET
          first_name = COALESCE(EXCLUDED.first_name, supporters.first_name),
          last_name  = COALESCE(EXCLUDED.last_name,  supporters.last_name),
          extra      = supporters.extra || EXCLUDED.extra,
          source     = EXCLUDED.source, imported_at = now(), updated_at = now()
        RETURNING (xmax = 0) AS inserted`, [email, first_name, last_name, JSON.stringify(extra), filename]);
      if (up.rows[0].inserted) result.created++; else result.updated++;
    } catch (e) { result.errors.push(`Řádek ${i + 2}: ${e.message}`); }
  }
  return result;
}

module.exports = { importSupporters, detectColumns, parseBuffer };
