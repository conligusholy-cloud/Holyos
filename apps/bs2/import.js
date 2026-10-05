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
    let text = buf.toString('utf8');
    if (text.includes('�')) { try { text = new TextDecoder('windows-1250').decode(buf); } catch (e) { /* utf8 */ } }
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

/**
 * @returns {Promise<{file, rows, created, updated, skipped, with_password, nick_conflicts, errors[], map, extraCols[]}>}
 */
async function importSupporters(buf, filename, { dry = false } = {}) {
  const { rows, headers } = parseBuffer(buf, filename);
  const map = detectColumns(headers);
  const result = { file: filename, rows: rows.length, created: 0, updated: 0, skipped: 0, with_password: 0, nick_conflicts: 0, errors: [], map, extraCols: [] };
  if (!rows.length) { result.errors.push('Soubor neobsahuje žádné řádky.'); return result; }
  if (!map.email) {
    for (const h of headers) { const hits = rows.slice(0, 50).filter(r => EMAIL_RE.test(String(r[h] || '').trim())).length; if (hits >= Math.min(rows.length, 50) * 0.5) { map.email = h; break; } }
  }
  if (!map.email) { result.errors.push('Nenašel jsem sloupec s e-mailem.'); return result; }
  const used = new Set([map.email, map.first_name, map.last_name, map.full_name, map.nick, map.password].filter(Boolean));
  result.extraCols = headers.filter(h => !used.has(h) && String(h).trim() && !/^__EMPTY/.test(h));

  const client = dry ? null : await pool.connect();
  const seen = new Set();
  try {
    if (client) await client.query('BEGIN');
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
      if (pw && !hash) extra[map.password] = pw; // nebcryptové heslo nelze použít k přihlášení — uložíme jen jako údaj
      const status = (hash && nick) ? 'active' : 'invited';

      if (dry) { result.created++; continue; }
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
      // s nickem (plná varianta) / bez nicku (když nick koliduje)
      const sqlFull = `INSERT INTO supporters (email, first_name, last_name, extra, source, imported_at, nick, password_hash, status, activated_at)
        VALUES ($1, $2, $3, $4::jsonb, $5, now(), $6, $7, $8, CASE WHEN $8 = 'active' THEN now() ELSE NULL END)` + UPSERT_TAIL;
      const sqlNoNick = `INSERT INTO supporters (email, first_name, last_name, extra, source, imported_at, nick, password_hash, status, activated_at)
        VALUES ($1, $2, $3, $4::jsonb, $5, now(), NULL, $6, 'invited', NULL)` + UPSERT_TAIL;
      const base = [email, first_name, last_name, JSON.stringify(extra), filename];
      try {
        await client.query('SAVEPOINT row_sp');
        let up;
        try { up = await client.query(sqlFull, base.concat([nick, hash, status])); }
        catch (e) {
          if (e.code === '23505' && /nick/.test(e.constraint || e.detail || '')) {
            // nick už má někdo jiný → uložíme bez nicku (uživatel si ho zvolí při aktivaci)
            await client.query('ROLLBACK TO SAVEPOINT row_sp');
            result.nick_conflicts++; result.errors.push(`Řádek ${i + 2}: nick „${nick}" už existuje — ${email} uložen bez nicku`);
            up = await client.query(sqlNoNick, base.concat([hash]));
          } else throw e;
        }
        await client.query('RELEASE SAVEPOINT row_sp');
        if (up.rows[0].inserted) result.created++; else result.updated++;
      } catch (e) {
        try { await client.query('ROLLBACK TO SAVEPOINT row_sp'); } catch (e2) { /* */ }
        result.skipped++; result.errors.push(`Řádek ${i + 2} (${email}): ${e.message}`);
      }
    }
    if (client) await client.query('COMMIT');
  } catch (e) {
    if (client) { try { await client.query('ROLLBACK'); } catch (e2) { /* */ } }
    throw e;
  } finally { if (client) client.release(); }
  return result;
}

module.exports = { importSupporters, detectColumns, parseBuffer };
