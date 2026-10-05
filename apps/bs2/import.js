// BS2 — import podporovatelů z CSV / XLSX (SheetJS). Režim 1:1: VŠECHNY sloupce zdroje se uloží
// (klíčové do vlastních polí, ostatní beze změny do `extra`), nic se nevyhazuje.
//   e-mail           → supporters.email (lowercase, klíč upsertu)
//   first/last name  → first_name / last_name
//   memb/nick/login  → nick (přezdívka ze starého systému)
//   password (bcrypt $2y$/$2a$/$2b$) → password_hash → podporovatel se přihlásí STARÝM nickem + heslem
//   active (0/1/2…)  → status: má-li hash+nick → 'active', jinak 'invited'; active=0 bez hashe → 'invited'
// Opakovaný import jen doplní/aktualizuje údaje; NIKDY nepřepíše nick/heslo, které si uživatel nastavil v BS2.

const XLSX = require('xlsx');
const { pool } = require('./db');

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$.{53}$/;

function detectColumns(headers) {
  const map = { email: null, first_name: null, last_name: null, full_name: null, nick: null, password: null, active: null };
  for (const h of headers) {
    const n = norm(h);
    if (!map.email && /(^|\s)(e ?mail|email|mail)(\s|$)/.test(n)) map.email = h;
    else if (!map.full_name && /(jmeno a prijmeni|prijmeni a jmeno|cele jmeno|full ?name|display ?name)/.test(n)) map.full_name = h;
    else if (!map.last_name && /(prijmeni|surname|last ?name|lastname)/.test(n)) map.last_name = h;
    else if (!map.first_name && /(krestni|first ?name|firstname|^jmeno$)/.test(n)) map.first_name = h;
    else if (!map.nick && /^(memb|nick|nickname|username|login|prezdivka)$/.test(n)) map.nick = h;
    else if (!map.password && /^(password|heslo|pass|pwd)$/.test(n)) map.password = h;
    else if (!map.active && /^(active|aktivni|status|stav)$/.test(n)) map.active = h;
    else if (!map.full_name && /(^|\s)name(\s|$)/.test(n) && !/user|nick|login|firm|company/.test(n)) map.full_name = h;
  }
  if (map.first_name && !map.last_name && !map.full_name) { map.full_name = map.first_name; map.first_name = null; }
  return map;
}

function splitFullName(v) {
  const parts = String(v || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: null, last_name: null };
  if (parts.length === 1) return { first_name: null, last_name: parts[0] };
  return { first_name: parts.slice(0, -1).join(' '), last_name: parts[parts.length - 1] };
}

function parseBuffer(buf, filename) {
  const isCsv = /\.csv$/i.test(filename || '');
  let wb;
  if (isCsv) {
    // Kódování: UTF-8, pokud dává smysl (české znaky bez mojibake). Na windows-1250 přepneme jen tehdy,
    // když je UTF-8 dekódování prokazatelně horší — pár vadných bajtů v souboru nestačí.
    let text = buf.toString('utf8');
    const bad = (text.match(/�/g) || []).length;
    if (bad > 0) {
      const score = (t) => (t.match(/[ěščřžýáíéúůťďňĚŠČŘŽÝÁÍÉÚŮŤĎŇ]/g) || []).length - 5 * (t.match(/[ÃÅĂ]/g) || []).length - 3 * (t.match(/�/g) || []).length;
      try { const cp = new TextDecoder('windows-1250').decode(buf); if (score(cp) > score(text)) text = cp; } catch (e) { /* utf8 */ }
    }
    text = text.replace(/^﻿/, '');
    const first = text.split('\n')[0];
    const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    wb = XLSX.read(text, { type: 'string', FS: delim, raw: true, dense: true });
  } else {
    wb = XLSX.read(buf, { type: 'buffer', cellDates: true, dense: true });
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { rows, headers };
}

const clean = (v) => { if (v == null) return null; if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' '); const s = String(v).trim(); return s === '' || s === 'NULL' ? null : s; };

const UPSERT_TAIL = `
  ON CONFLICT (email) DO UPDATE SET
    first_name    = COALESCE(EXCLUDED.first_name, supporters.first_name),
    last_name     = COALESCE(EXCLUDED.last_name,  supporters.last_name),
    extra         = supporters.extra || EXCLUDED.extra,
    nick          = COALESCE(supporters.nick, EXCLUDED.nick),
    password_hash = COALESCE(supporters.password_hash, EXCLUDED.password_hash),
    status        = CASE WHEN supporters.status = 'blocked' THEN 'blocked'
                         WHEN COALESCE(supporters.password_hash, EXCLUDED.password_hash) IS NOT NULL AND COALESCE(supporters.nick, EXCLUDED.nick) IS NOT NULL THEN 'active'
                         ELSE supporters.status END,
    activated_at  = COALESCE(supporters.activated_at, EXCLUDED.activated_at),
    source = EXCLUDED.source, imported_at = now(), updated_at = now()
  RETURNING (xmax = 0) AS inserted`;
// Dávkový upsert přes unnest (jeden dotaz na stovky řádků)
const SQL_BATCH = `INSERT INTO supporters (email, first_name, last_name, extra, source, imported_at, nick, password_hash, status, activated_at)
  SELECT t.email, t.first_name, t.last_name, t.extra::jsonb, t.source, now(), t.nick, t.password_hash, t.status, CASE WHEN t.status = 'active' THEN now() ELSE NULL END
  FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) AS t(email, first_name, last_name, extra, source, nick, password_hash, status)` + UPSERT_TAIL;
const SQL_ONE = `INSERT INTO supporters (email, first_name, last_name, extra, source, imported_at, nick, password_hash, status, activated_at)
  VALUES ($1, $2, $3, $4::jsonb, $5, now(), $6, $7, $8, CASE WHEN $8 = 'active' THEN now() ELSE NULL END)` + UPSERT_TAIL;
const SQL_ONE_NONICK = `INSERT INTO supporters (email, first_name, last_name, extra, source, imported_at, nick, password_hash, status, activated_at)
  VALUES ($1, $2, $3, $4::jsonb, $5, now(), NULL, $6, 'invited', NULL)` + UPSERT_TAIL;

/**
 * Připraví řádky (validace, mapování) — rychlé, synchronní. Vrací { result, prepared }.
 */
function prepareImport(buf, filename) {
  const { rows, headers } = parseBuffer(buf, filename);
  const map = detectColumns(headers);
  const result = { file: filename, rows: rows.length, created: 0, updated: 0, skipped: 0, with_password: 0, nick_conflicts: 0, errors: [], map, extraCols: [] };
  if (!rows.length) { result.errors.push('Soubor neobsahuje žádné řádky.'); return { result, prepared: [] }; }
  if (!map.email) {
    for (const h of headers) { const hits = rows.slice(0, 50).filter(r => EMAIL_RE.test(String(r[h] || '').trim())).length; if (hits >= Math.min(rows.length, 50) * 0.5) { map.email = h; break; } }
  }
  if (!map.email) { result.errors.push('Nenašel jsem sloupec s e-mailem.'); return { result, prepared: [] }; }
  const used = new Set([map.email, map.first_name, map.last_name, map.full_name, map.nick, map.password].filter(Boolean));
  result.extraCols = headers.filter(h => !used.has(h) && String(h).trim() && !/^__EMPTY/.test(h));

  const seen = new Set(); const prepared = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const email = String(r[map.email] || '').trim().toLowerCase();
    if (!email) { result.skipped++; result.errors.push(`Řádek ${i + 2}: prázdný e-mail (přeskočeno)`); continue; }
    if (!EMAIL_RE.test(email)) { result.skipped++; result.errors.push(`Řádek ${i + 2}: neplatný e-mail „${email}" (přeskočeno)`); continue; }
    if (seen.has(email)) { result.skipped++; result.errors.push(`Řádek ${i + 2}: duplicitní e-mail ${email} (použit první výskyt)`); continue; }
    seen.add(email);
    let first_name = map.first_name ? clean(r[map.first_name]) : null;
    let last_name = map.last_name ? clean(r[map.last_name]) : null;
    if (map.full_name && (!first_name || !last_name)) { const sp = splitFullName(r[map.full_name]); first_name = first_name || sp.first_name; last_name = last_name || sp.last_name; }
    const nick = map.nick ? clean(r[map.nick]) : null;
    const pw = map.password ? clean(r[map.password]) : null;
    const hash = pw && BCRYPT_RE.test(pw) ? pw : null;
    if (hash) result.with_password++;
    const extra = {};
    for (const h of result.extraCols) { const v = clean(r[h]); if (v !== null) extra[String(h).trim()] = v; }
    if (pw && !hash) extra[map.password] = pw;
    prepared.push({ line: i + 2, email, first_name, last_name, extra: JSON.stringify(extra), nick, hash, status: (hash && nick) ? 'active' : 'invited' });
  }
  return { result, prepared };
}

/**
 * Zapíše připravené řádky do DB po dávkách. onProgress(processed) se volá po každé dávce.
 */
async function writeImport(prepared, result, { onProgress, batchSize = 300 } = {}) {
  const client = await pool.connect();
  let processed = 0;
  try {
    for (let off = 0; off < prepared.length; off += batchSize) {
      const chunk = prepared.slice(off, off + batchSize);
      try {
        const up = await client.query(SQL_BATCH, [chunk.map(x => x.email), chunk.map(x => x.first_name), chunk.map(x => x.last_name), chunk.map(x => x.extra), chunk.map(() => result.file), chunk.map(x => x.nick), chunk.map(x => x.hash), chunk.map(x => x.status)]);
        for (const row of up.rows) { if (row.inserted) result.created++; else result.updated++; }
      } catch (e) {
        // dávka spadla (typicky kolize nicku) → zpracuj po řádcích
        for (const x of chunk) {
          const base = [x.email, x.first_name, x.last_name, x.extra, result.file];
          try {
            let up;
            try { up = await client.query(SQL_ONE, base.concat([x.nick, x.hash, x.status])); }
            catch (e1) {
              if (e1.code === '23505' && /nick/.test((e1.constraint || '') + (e1.detail || ''))) {
                result.nick_conflicts++; result.errors.push(`Řádek ${x.line}: nick „${x.nick}" už existuje — ${x.email} uložen bez nicku`);
                up = await client.query(SQL_ONE_NONICK, base.concat([x.hash]));
              } else throw e1;
            }
            if (up.rows[0].inserted) result.created++; else result.updated++;
          } catch (e2) { result.skipped++; result.errors.push(`Řádek ${x.line} (${x.email}): ${e2.message}`); }
        }
      }
      processed += chunk.length;
      if (onProgress) onProgress(processed);
    }
  } finally { client.release(); }
  return result;
}

/** Jednorázový import (zkouška nebo malé soubory). */
async function importSupporters(buf, filename, { dry = false, onProgress } = {}) {
  const { result, prepared } = prepareImport(buf, filename);
  if (dry || !prepared.length) { result.created = prepared.length; return result; }
  return writeImport(prepared, result, { onProgress });
}

module.exports = { importSupporters, prepareImport, writeImport, detectColumns, parseBuffer };
