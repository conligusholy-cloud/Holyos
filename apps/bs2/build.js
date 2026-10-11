// BS2 — číslování verzí: 2.0.<build>. Build se zvýší automaticky vždy, když se nahraje nová verze aplikace
// (změní se commit z Railway, případně nejnovější čas změny souborů), a uloží se čas této aktualizace.
// Údaje drží app_settings ('build_info'), takže přežijí restart a sdílí je všechny instance.
const fs = require('fs');
const path = require('path');
const { q } = require('./db');

const BASE = '2.0';
let current = null;

function fingerprint() {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.SOURCE_COMMIT || '';
  if (sha) return { fp: 'git:' + sha, sha: sha.slice(0, 7) };
  // Bez gitu (např. railway up): nejnovější změna zdrojových souborů
  let m = 0;
  try { for (const f of fs.readdirSync(__dirname)) { if (/\.(js|json)$/.test(f)) m = Math.max(m, fs.statSync(path.join(__dirname, f)).mtimeMs); } } catch (e) { /* ignore */ }
  return { fp: 'mtime:' + Math.round(m), sha: '' };
}

async function init() {
  const { fp, sha } = fingerprint();
  let info = null;
  try { const r = await q("SELECT value FROM app_settings WHERE key='build_info'"); if (r.rows[0]) info = JSON.parse(r.rows[0].value); } catch (e) { info = null; }
  if (!info || info.fp !== fp) {
    info = { fp, sha, n: ((info && info.n) || 0) + 1, at: new Date().toISOString() };
    try { await q("INSERT INTO app_settings (key,value) VALUES ('build_info',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(info)]); } catch (e) { /* bez DB jen v paměti */ }
  }
  current = { version: BASE + '.' + info.n, sha: info.sha || '', at: info.at };
  return current;
}

module.exports = { init, get: () => current };
