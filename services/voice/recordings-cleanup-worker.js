// =============================================================================
// HolyOS — Hlídač úložiště (volume /app/data + Postgres) a archiv nahrávek hovorů
// =============================================================================
// Cíl: data se neztratí A provoz se nezastaví plným diskem.
//
// 1) Nahrávky hovorů (data/voice-recordings/*.mp3): lokální kopie starší než
//    VOICE_RECORDINGS_KEEP_DAYS (výchozí 30) se NEJDŘÍV nahrají do soukromého R2 bucketu
//    R2_ARCHIVE_BUCKET (klíč voice-recordings/<soubor>) a teprve po úspěšném nahrání se smažou
//    z volume. Bez R2_ARCHIVE_BUCKET se nic nemaže (jen se hlídá místo).
//    Přehrání staré nahrávky: ensureLocalRecording → Twilio, a když tam není, z archivu R2.
// 2) Volume /app/data: obsazenost ≥ 75 / 85 / 95 % → Velín push + zvonek Tomášovi a Janovi
//    (každá úroveň nejvýš 1× denně).
// 3) Postgres: velikost DB vs. PG_VOLUME_GB (výchozí 5) → stejné úrovně upozornění.

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DIR = path.join(DATA_DIR, 'voice-recordings');
const KEEP_DAYS = Math.max(7, parseInt(process.env.VOICE_RECORDINGS_KEEP_DAYS || '30', 10) || 30);
const LEVELS = [95, 85, 75];
const ALERT_KEY = 'storage_guard.alerts';
const ARCHIVE_PREFIX = 'voice-recordings/';

function archiveBucket() { return process.env.R2_ARCHIVE_BUCKET || ''; }
function r2() { try { return require('../storage/r2').getClient(); } catch (_) { return null; } }

// ── Archiv nahrávek v R2 (soukromý bucket) ──
async function archivePut(name, buf) {
  const c = r2(); const b = archiveBucket(); if (!c || !b) return false;
  const { PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
  await c.send(new PutObjectCommand({ Bucket: b, Key: ARCHIVE_PREFIX + name, Body: buf, ContentType: 'audio/mpeg' }));
  const h = await c.send(new HeadObjectCommand({ Bucket: b, Key: ARCHIVE_PREFIX + name }));
  return Number(h.ContentLength) === buf.length; // smazat lokálně jen po ověření velikosti
}
// Stáhne nahrávku z archivu (null = není / archiv vypnutý)
async function archiveGet(name) {
  const c = r2(); const b = archiveBucket(); if (!c || !b) return null;
  try {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const r = await c.send(new GetObjectCommand({ Bucket: b, Key: ARCHIVE_PREFIX + name }));
    return Buffer.from(await r.Body.transformToByteArray());
  } catch (_) { return null; }
}

async function archiveOldRecordings() {
  if (!fs.existsSync(DIR)) return { archived: 0, mb: 0, enabled: !!archiveBucket() };
  const limit = Date.now() - KEEP_DAYS * 86400000;
  let archived = 0, bytes = 0;
  for (const name of fs.readdirSync(DIR)) {
    const f = path.join(DIR, name);
    let st; try { st = fs.statSync(f); } catch (_) { continue; }
    if (!st.isFile()) continue;
    if (/\.mp3\.part$/i.test(name)) { if (st.mtimeMs < Date.now() - 86400000) { try { fs.unlinkSync(f); } catch (_) {} } continue; } // nedokončené stažení
    if (!/\.mp3$/i.test(name) || st.mtimeMs >= limit) continue;
    if (!archiveBucket()) continue; // bez archivu nic nemažeme
    try {
      const ok = await archivePut(name, fs.readFileSync(f));
      if (ok) { fs.unlinkSync(f); archived++; bytes += st.size; }
    } catch (e) { console.warn('[storage-guard] archiv nahrávky selhal:', name, e.message); break; } // R2 nedostupné → zkusí příště
  }
  if (archived) console.log('[storage-guard] do R2 archivu přesunuto ' + archived + ' nahrávek (' + Math.round(bytes / 1048576) + ' MB)');
  return { archived, mb: Math.round(bytes / 1048576), enabled: !!archiveBucket() };
}

// ── Obsazenost ──
function volumeUsage() {
  try {
    const s = fs.statfsSync(DATA_DIR);
    const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
    return { total, used: total - free, pct: total ? Math.round(((total - free) / total) * 1000) / 10 : 0 };
  } catch (_) { return null; }
}
async function pgUsage() {
  try {
    const { prisma } = require('../../config/database');
    const r = await prisma.$queryRawUnsafe('SELECT pg_database_size(current_database())::bigint AS b');
    const used = Number(r[0].b); const total = (parseFloat(process.env.PG_VOLUME_GB || '5') || 5) * 1073741824;
    return { total, used, pct: Math.round((used / total) * 1000) / 10 };
  } catch (_) { return null; }
}
const gb = (b) => (b / 1073741824).toFixed(2).replace('.', ',') + ' GB';

async function alertIfNeeded(kind, label, u, hint) {
  if (!u) return;
  const level = LEVELS.find((l) => u.pct >= l); if (!level) return;
  const { getSetting, setSetting } = require('../settings');
  const day = new Date().toISOString().slice(0, 10);
  const seen = (await getSetting(ALERT_KEY, { type: 'json', defaultValue: {} }).catch(() => ({}))) || {};
  const k = kind + ':' + level;
  if (seen[k] === day) return;
  seen[k] = day;
  await setSetting(ALERT_KEY, seen, { type: 'json', description: 'Hlídač úložiště — kdy naposledy šlo upozornění (úroveň → den)', scope: 'system' }).catch(() => {});
  const title = (level >= 95 ? '🛑 ' : level >= 85 ? '⚠️ ' : '💾 ') + label + ' je zaplněno na ' + String(u.pct).replace('.', ',') + ' %';
  const body = gb(u.used) + ' z ' + gb(u.total) + '. ' + hint;
  console.warn('[storage-guard] ' + title + ' — ' + body);
  try {
    const { prisma } = require('../../config/database');
    const { notifyPerson } = require('../push/expo-push');
    const { createNotification } = require('../../routes/notifications.routes');
    const ps = await prisma.person.findMany({ where: { active: true, last_name: { equals: 'Holý', mode: 'insensitive' }, first_name: { in: ['Tomáš', 'Jan'], mode: 'insensitive' } }, select: { id: true, user_id: true } });
    for (const p of ps) {
      notifyPerson(prisma, p.id, { title, body, data: { type: 'storage_alert', kind, level }, sound: 'default' }).catch(() => {});
      if (p.user_id) createNotification({ userId: p.user_id, type: 'system', title, body, link: null, meta: { kind, level } }).catch(() => {});
    }
  } catch (e) { console.warn('[storage-guard] upozornění selhalo:', e.message); }
}

let running = false;
async function tick() {
  if (running) return; running = true;
  try {
    await archiveOldRecordings();
    await alertIfNeeded('volume', 'Úložiště souborů (Railway volume)', volumeUsage(), 'Railway → attractive-consideration → volume → Settings → zvětšit (Resize). ' + (archiveBucket() ? '' : 'Archiv nahrávek do R2 není zapnutý (R2_ARCHIVE_BUCKET).'));
    await alertIfNeeded('postgres', 'Databáze Postgres', await pgUsage(), 'Railway → Postgres → postgres-volume → Settings → zvětšit (Resize) a nastavit PG_VOLUME_GB.');
  } catch (e) {
    console.warn('[storage-guard] tick selhal:', e.message);
  } finally { running = false; }
}

let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(tick, 6 * 60 * 60 * 1000); // 4× denně
  setTimeout(tick, 5 * 60 * 1000);
  console.log('[storage-guard] spuštěn (nahrávky > ' + KEEP_DAYS + ' dní → ' + (archiveBucket() ? 'R2 archiv ' + archiveBucket() : 'archiv vypnutý, nic se nemaže') + '; upozornění od 75 %)');
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { start, stop, tick, archiveGet, volumeUsage, pgUsage };
