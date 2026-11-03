// HolyOS — Šifrované zálohy databáze do Cloudflare R2 (nezávislá kopie mimo Railway)
// Každou noc: pg_dump (custom formát, komprimovaný) → šifrování AES-256-GCM (klíč BACKUP_ENC_KEY) → upload do R2_BACKUP_BUCKET.
// Retence: posledních 30 denních záloh + první záloha každého měsíce (12 měsíců).
// Env: DATABASE_URL, BACKUP_ENC_KEY (min. 32 znaků), R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY, R2_BACKUP_BUCKET (SOUKROMÝ bucket!).
// Obnova: scripts/restore-backup.js (dešifrování) + pg_restore.
'use strict';
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const r2 = require('../storage/r2');
const { getSetting, setSetting } = require('../settings');

const MAGIC = Buffer.from('HOSBK1');
const PREFIX = 'db-backups/';
const KEEP_DAILY = 30, KEEP_MONTHLY = 12;
const STATUS_KEY = 'backup.status';
let running = false;

const keyBuf = () => { const k = process.env.BACKUP_ENC_KEY; return k && k.length >= 32 ? crypto.createHash('sha256').update('backup:' + k).digest() : null; };
const configured = () => !!(keyBuf() && process.env.R2_BACKUP_BUCKET && process.env.DATABASE_URL && r2.getClient());

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, Object.assign({ stdio: ['ignore', 'ignore', 'pipe'] }, opts));
    let err = ''; p.stderr.on('data', (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(cmd + ' skončil kódem ' + code + ': ' + err.slice(-500))));
  });
}

// Zašifruje soubor: MAGIC | iv(12) | ciphertext | tag(16)
function encryptFile(src, dst) {
  return new Promise((resolve, reject) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', keyBuf(), iv);
    const out = fs.createWriteStream(dst);
    out.write(Buffer.concat([MAGIC, iv]));
    const inp = fs.createReadStream(src);
    inp.on('error', reject); out.on('error', reject);
    inp.pipe(c, { end: true });
    c.on('data', (d) => out.write(d));
    c.on('end', () => { out.write(c.getAuthTag()); out.end(); });
    out.on('finish', resolve);
    c.on('error', reject);
  });
}

async function listAll() {
  const client = r2.getClient(); const out = []; let token;
  do {
    const r = await client.send(new ListObjectsV2Command({ Bucket: process.env.R2_BACKUP_BUCKET, Prefix: PREFIX, ContinuationToken: token }));
    (r.Contents || []).forEach((o) => out.push({ key: o.Key, size: o.Size, at: o.LastModified }));
    token = r.IsTruncated ? r.NextContinuationToken : null;
  } while (token);
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

async function applyRetention() {
  const all = await listAll(); // klíče: db-backups/YYYY-MM-DD_HHmm.dump.enc → řazení = chronologicky
  const keep = new Set(all.slice(-KEEP_DAILY).map((o) => o.key));
  const months = new Map();
  for (const o of all) { const m = o.key.slice(PREFIX.length, PREFIX.length + 7); if (!months.has(m)) months.set(m, o.key); }
  Array.from(months.values()).slice(-KEEP_MONTHLY).forEach((k) => keep.add(k));
  let deleted = 0;
  for (const o of all) if (!keep.has(o.key)) { await r2.getClient().send(new DeleteObjectCommand({ Bucket: process.env.R2_BACKUP_BUCKET, Key: o.key })); deleted++; }
  return deleted;
}

async function setStatus(s) { try { await setSetting(STATUS_KEY, s, { type: 'json', scope: 'backup' }); } catch (e) { /* best-effort */ } }

async function runBackup(trigger) {
  if (running) return { ok: false, error: 'Záloha už běží' };
  if (!configured()) return { ok: false, error: 'Zálohy nejsou nakonfigurované (BACKUP_ENC_KEY, R2_BACKUP_BUCKET, R2_*)' };
  running = true;
  const started = Date.now();
  const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Prague' }).replace(' ', '_').replace(/:/g, '').slice(0, 15);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hosbk-'));
  const dump = path.join(tmp, 'db.dump'), enc = path.join(tmp, 'db.dump.enc');
  try {
    await run('pg_dump', ['--format=custom', '--compress=6', '--no-owner', '--no-privileges', '--file', dump, process.env.DATABASE_URL]);
    await encryptFile(dump, enc);
    fs.rmSync(dump, { force: true });
    const size = fs.statSync(enc).size;
    const key = PREFIX + stamp + '.dump.enc';
    await r2.getClient().send(new PutObjectCommand({ Bucket: process.env.R2_BACKUP_BUCKET, Key: key, Body: fs.createReadStream(enc), ContentLength: size, ContentType: 'application/octet-stream' }));
    const deleted = await applyRetention().catch((e) => { console.warn('[backup] retence selhala:', e.message); return 0; });
    const st = { ok: true, at: new Date().toISOString(), key, size, seconds: Math.round((Date.now() - started) / 1000), deleted_old: deleted, trigger: trigger || 'auto' };
    await setStatus(st);
    console.log('[backup] OK', key, (size / 1048576).toFixed(1) + ' MB,', st.seconds + ' s');
    return st;
  } catch (e) {
    const st = { ok: false, at: new Date().toISOString(), error: String(e.message || e).slice(0, 600), trigger: trigger || 'auto' };
    await setStatus(st);
    console.error('[backup] SELHALA:', st.error);
    try { // upozornění e-mailem
      const to = process.env.BACKUP_ALERT_EMAIL || 'tomas.holy@bestseries.cz';
      await require('../email').sendMail({ to, subject: '⚠️ Záloha databáze HolyOS selhala', body: 'Noční záloha databáze selhala.\n\nChyba: ' + st.error + '\n\nZkontroluj logy na Railway a zkus ruční spuštění (super admin: POST /api/admin/backup/run).' });
    } catch (mailErr) { /* e-mail je jen bonus */ }
    return st;
  } finally {
    running = false;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

async function status() {
  let last = null; try { last = await getSetting(STATUS_KEY, { type: 'json', defaultValue: null }); } catch (e) { last = null; }
  let list = []; if (configured()) { try { list = await listAll(); } catch (e) { list = []; } }
  return { configured: configured(), running, last, count: list.length, newest: list.length ? list[list.length - 1] : null, total_bytes: list.reduce((s, o) => s + (o.size || 0), 0) };
}

// Stažení zašifrované zálohy (pro test obnovy). Bez klíče je soubor nečitelný. key = konkrétní záloha, jinak nejnovější.
async function openDownload(key) {
  if (!configured()) throw Object.assign(new Error('Zálohy nejsou nakonfigurované'), { status: 503 });
  const list = await listAll();
  const item = key ? list.find((o) => o.key === key) : list[list.length - 1];
  if (!item) throw Object.assign(new Error('Záloha nenalezena'), { status: 404 });
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const r = await r2.getClient().send(new GetObjectCommand({ Bucket: process.env.R2_BACKUP_BUCKET, Key: item.key }));
  return { stream: r.Body, size: item.size, name: item.key.slice(PREFIX.length) };
}

// Plánovač: každý den ve 2:30 (Europe/Prague); při startu doběhne, pokud poslední úspěšná záloha je starší než 26 h
function start() {
  if (!configured()) { console.warn('[backup] zálohy vypnuté — chybí BACKUP_ENC_KEY / R2_BACKUP_BUCKET / R2_* / DATABASE_URL'); return; }
  const tick = async () => {
    try {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
      if (now.getHours() === 2 && now.getMinutes() >= 30 && now.getMinutes() < 45) {
        const s = await getSetting(STATUS_KEY, { type: 'json', defaultValue: null }).catch(() => null);
        if (!(s && s.ok && Date.now() - new Date(s.at).getTime() < 20 * 3600e3)) await runBackup('auto');
      }
    } catch (e) { console.warn('[backup] tick:', e.message); }
  };
  setInterval(tick, 5 * 60e3).unref();
  // doběh po startu (např. po výpadku): bez úspěšné zálohy za posledních 26 h spustit za 3 min
  setTimeout(async () => {
    const s = await getSetting(STATUS_KEY, { type: 'json', defaultValue: null }).catch(() => null);
    if (!(s && s.ok && Date.now() - new Date(s.at).getTime() < 26 * 3600e3)) await runBackup('catchup');
  }, 3 * 60e3).unref();
  console.log('[backup] plánovač zapnut (denně 2:30)');
}

module.exports = { runBackup, status, start, configured, openDownload, _encryptFile: encryptFile };
