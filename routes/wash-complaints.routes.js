// =============================================================================
// HolyOS — Reklamace praní (Servis → Reklamace praní)
// =============================================================================
// Zákazník samoobslužného prádlomatu vyplní na pradlomaty.info/podpora:
//   • žádost o vrácení platby  (kind = refund)
//   • žádost o zaslání dokladu (kind = receipt) — max. 350 Kč za jednu transakci
// Žádost se uloží jako WashComplaint, přijde upozornění do Velína a zpracuje se v Servisu.
//
// Veřejné (bez auth):  /api/public/wash/*   — místa (SIS), odeslání žádosti
// Interní (auth):      /api/wash-complaints/* — seznam, detail, stav, doklad PDF, nastavení
//
// Ochrana veřejného formuláře (bez captchy): skryté pole (honeypot), podepsaný časový
// token (formulář nesmí být odeslán dřív než za 4 s ani později než za 2 h), limit žádostí
// z jedné IP i na jeden e-mail, přísná validace všech polí.
// =============================================================================
'use strict';

const express = require('express');
const crypto = require('crypto');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const publicRouter = express.Router();
publicRouter.use(express.json({ limit: '20kb' }));

const NOTIFY_KEY = 'wash.velin_notify_person_ids';
const SETTINGS_KEY = 'wash.settings';
const RECEIPT_MAX = 350;
const PAY_METHODS = ['Platební karta', 'Mobil (Apple Pay / Google Pay)', 'Mince', 'Bankovky', 'Aplikace', 'Jiný'];
const SERVICES = ['Praní 8 kg', 'Praní 18 kg', 'Praní 18 kg + aviváž', 'Sušení', 'Praní + sušení', 'Jiná'];
const KIND_LABEL = { refund: 'Vrácení platby', receipt: 'Zaslání dokladu' };

const s = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ipOf = (req) => String(req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim().slice(0, 64);
const kc = (n) => Number(n).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Kč';

async function getSettings() {
  const { getSetting } = require('../services/settings');
  const v = await getSetting(SETTINGS_KEY, { type: 'json', defaultValue: {} }).catch(() => ({}));
  return Object.assign({ vat_rate: 21, receipt_note: '' }, v && typeof v === 'object' ? v : {});
}

// ─── Místa (prádlomaty ze SIS; při výpadku poslední uložený snapshot) ─────────
let placesCache = { at: 0, list: null };
async function loadPlaces() {
  if (placesCache.list && Date.now() - placesCache.at < 10 * 60e3) return placesCache.list;
  let kiosks = null;
  const key = process.env.SIS_KIOSK_API_KEY;
  if (key) {
    try {
      const url = process.env.SIS_KIOSK_API_URL || 'https://sis-test.infinitygrid.cloud/api/public/kiosk-values';
      const r = await fetch(url, { headers: { 'X-API-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
      if (r.ok) { const j = await r.json(); if (Array.isArray(j.kiosks)) kiosks = j.kiosks; }
    } catch (e) { /* zkusíme snapshot */ }
  }
  if (!kiosks) {
    try {
      const snap = await require('../services/settings').getSetting('compounding.kiosk_values_snapshot', { type: 'json', defaultValue: null });
      if (snap && Array.isArray(snap.kiosks)) kiosks = snap.kiosks;
    } catch (e) { /* bez míst */ }
  }
  const list = (kiosks || []).map((k) => ({ code: String(k.code || k.id || '').slice(0, 40), label: s(k.label || k.name || k.code, 200), address: s(k.address, 300) }))
    .filter((k) => k.label).sort((a, b) => a.label.localeCompare(b.label, 'cs'));
  if (list.length) placesCache = { at: Date.now(), list };
  return list.length ? list : (placesCache.list || []);
}

// ─── Ochrana formuláře ───────────────────────────────────────────────────────
const SECRET = process.env.WASH_FORM_SECRET || process.env.JWT_SECRET || process.env.SESSION_SECRET || 'holyos-wash';
function formToken() {
  const t = Date.now().toString(36), sig = crypto.createHmac('sha256', SECRET).update('wash:' + t).digest('hex').slice(0, 24);
  return t + '.' + sig;
}
function checkToken(tok) {
  const [t, sig] = String(tok || '').split('.');
  if (!t || !sig) return 'Formulář vypršel — načtěte stránku znovu.';
  const exp = crypto.createHmac('sha256', SECRET).update('wash:' + t).digest('hex').slice(0, 24);
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return 'Formulář vypršel — načtěte stránku znovu.';
  const age = Date.now() - parseInt(t, 36);
  if (!(age >= 4000)) return 'Odesláno příliš rychle — zkontrolujte prosím údaje a odešlete znovu.';
  if (age > 2 * 3600e3) return 'Formulář vypršel — načtěte stránku znovu.';
  return null;
}
// Ověření „Jsem člověk" bez cizí služby: proof-of-work. Server vydá podepsanou výzvu (salt), prohlížeč
// najde číslo, se kterým SHA-256(salt + číslo) začíná N nulami (pár sekund práce), server to ověří.
// Pro člověka je to jedno kliknutí, pro hromadné roboty drahé. Každé řešení platí jen jednou a 30 minut.
const POW_ZEROS = 4; // hex nuly na začátku (~65 tisíc pokusů)
const powUsed = new Map();
function powChallenge() {
  const salt = crypto.randomBytes(12).toString('hex'), exp = Date.now() + 30 * 60e3;
  const sig = crypto.createHmac('sha256', SECRET).update('pow:' + salt + ':' + exp).digest('hex').slice(0, 32);
  return { salt, exp, sig, zeros: POW_ZEROS };
}
function powCheck(p) {
  if (!p || typeof p !== 'object') return 'Potvrďte prosím, že jste člověk.';
  const salt = String(p.salt || ''), exp = Number(p.exp), sig = String(p.sig || ''), nonce = String(p.nonce || '');
  if (!/^[a-f0-9]{24}$/.test(salt) || !/^\d{1,12}$/.test(nonce) || !(exp > Date.now())) return 'Ověření vypršelo — potvrďte prosím znovu, že jste člověk.';
  const ok = crypto.createHmac('sha256', SECRET).update('pow:' + salt + ':' + exp).digest('hex').slice(0, 32);
  if (sig.length !== ok.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(ok))) return 'Ověření není platné — načtěte stránku znovu.';
  if (!crypto.createHash('sha256').update(salt + nonce).digest('hex').startsWith('0'.repeat(POW_ZEROS))) return 'Ověření se nepovedlo — zkuste to prosím znovu.';
  if (powUsed.has(salt)) return 'Ověření už bylo použito — potvrďte prosím znovu, že jste člověk.';
  powUsed.set(salt, exp); if (powUsed.size > 20000) { const now = Date.now(); for (const [k, v] of powUsed) if (v < now) powUsed.delete(k); }
  return null;
}
// ─── Obrázková výzva (po „Jsem člověk") — vyber všechny obrázky dané věci ────────
// Obrázky kreslí server (SVG, náhodné barvy/natočení/velikost), správnou odpověď nikam neposílá —
// v podpisu je jen HMAC(salt + správné pozice). Výzva platí jednou, 10 minut, max 3 pokusy z IP za minutu.
const IMG_ICONS = {
  pracka: { nazev: 'pračkou', d: (c) => `<rect x="12" y="8" width="40" height="48" rx="5" fill="${c}"/><rect x="12" y="8" width="40" height="10" rx="5" fill="#00000022"/><circle cx="20" cy="13" r="2" fill="#fff"/><circle cx="27" cy="13" r="2" fill="#fff"/><circle cx="32" cy="36" r="13" fill="#e8f4ff" stroke="#00000044" stroke-width="3"/><path d="M22 38q5-5 10 0t10 0" stroke="#3b82f6" stroke-width="3" fill="none"/>` },
  triko: { nazev: 'tričkem', d: (c) => `<path d="M22 10l-12 8 6 10 6-3v29h20V25l6 3 6-10-12-8q-4 6-10 6t-10-6z" fill="${c}"/>` },
  auto: { nazev: 'autem', d: (c) => `<path d="M8 38l5-12q2-4 6-4h22q4 0 6 4l5 12v8H8z" fill="${c}"/><rect x="18" y="26" width="10" height="8" rx="1" fill="#dbeafe"/><rect x="31" y="26" width="10" height="8" rx="1" fill="#dbeafe"/><circle cx="19" cy="47" r="5" fill="#222"/><circle cx="45" cy="47" r="5" fill="#222"/>` },
  strom: { nazev: 'stromem', d: (c) => `<rect x="29" y="38" width="6" height="18" fill="#7c4a1e"/><circle cx="32" cy="26" r="16" fill="${c}"/><circle cx="22" cy="32" r="9" fill="${c}"/><circle cx="42" cy="32" r="9" fill="${c}"/>` },
  ryba: { nazev: 'rybou', d: (c) => `<path d="M10 32q14-16 32 0-18 16-32 0z" fill="${c}"/><path d="M42 32l12-10v20z" fill="${c}"/><circle cx="19" cy="29" r="2.5" fill="#111"/>` },
  hvezda: { nazev: 'hvězdou', d: (c) => `<path d="M32 8l7 15 16 2-12 11 3 16-14-8-14 8 3-16-12-11 16-2z" fill="${c}"/>` },
  dum: { nazev: 'domem', d: (c) => `<path d="M10 30L32 12l22 18" fill="none" stroke="${c}" stroke-width="5" stroke-linejoin="round"/><rect x="16" y="30" width="32" height="24" fill="${c}"/><rect x="28" y="40" width="8" height="14" fill="#fff"/>` },
  hrnek: { nazev: 'hrnkem', d: (c) => `<rect x="14" y="18" width="28" height="32" rx="4" fill="${c}"/><path d="M42 24h6q6 0 6 8t-6 8h-6" fill="none" stroke="${c}" stroke-width="5"/>` },
  ponozka: { nazev: 'ponožkou', d: (c) => `<path d="M24 8h16v28l8 8q4 6-2 10t-12-2L20 40q-2-2-2-6V8z" fill="${c}"/><rect x="22" y="8" width="20" height="6" fill="#00000022"/>` },
};
const IMG_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b', '#84cc16', '#0ea5e9'];
const imgUsed = new Map();
function imgChallenge() {
  const keys = Object.keys(IMG_ICONS), rnd = (n) => crypto.randomInt(n);
  const target = ['pracka', 'triko', 'ponozka', 'auto', 'strom', 'ryba'][rnd(6)];
  const pocet = 2 + rnd(3); // 2–4 správné
  const others = keys.filter((k) => k !== target);
  const cells = Array.from({ length: 9 }, (_, i) => (i < pocet ? target : others[rnd(others.length)]));
  for (let i = cells.length - 1; i > 0; i--) { const j = rnd(i + 1); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  const tiles = cells.map((k) => {
    const c = IMG_COLORS[rnd(IMG_COLORS.length)], bg = ['#eef6ff', '#f3f0ff', '#effaf3', '#fff7ed', '#f8fafc'][rnd(5)];
    const rot = rnd(50) - 25, sc = (80 + rnd(30)) / 100, dx = rnd(10) - 5, dy = rnd(10) - 5;
    const noise = Array.from({ length: 5 }, () => `<circle cx="${rnd(64)}" cy="${rnd(64)}" r="${1 + rnd(4)}" fill="${IMG_COLORS[rnd(IMG_COLORS.length)]}" opacity=".35"/>`).join('');
    return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64" fill="${bg}"/>${noise}<g transform="translate(${32 + dx} ${32 + dy}) rotate(${rot}) scale(${sc}) translate(-32 -32)">${IMG_ICONS[k].d(c)}</g></svg>`;
  });
  const correct = cells.map((k, i) => (k === target ? i : -1)).filter((i) => i >= 0).join(',');
  const salt = crypto.randomBytes(12).toString('hex'), exp = Date.now() + 10 * 60e3;
  const sig = crypto.createHmac('sha256', SECRET).update('img:' + salt + ':' + exp + ':' + correct).digest('hex').slice(0, 32);
  return { salt, exp, sig, otazka: 'Vyberte všechny obrázky s ' + IMG_ICONS[target].nazev, tiles };
}
function imgCheck(p) {
  if (!p || typeof p !== 'object') return 'Vyřešte prosím obrázkovou úlohu.';
  const salt = String(p.salt || ''), exp = Number(p.exp), sig = String(p.sig || '');
  if (!/^[a-f0-9]{24}$/.test(salt) || !(exp > Date.now())) return 'Úloha vypršela — zkuste novou.';
  if (imgUsed.has(salt)) return 'Úloha už byla použita — zkuste novou.';
  imgUsed.set(salt, exp); if (imgUsed.size > 20000) { const now = Date.now(); for (const [k, v] of imgUsed) if (v < now) imgUsed.delete(k); }
  const pick = [...new Set((Array.isArray(p.pick) ? p.pick : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 9))].sort((a, b) => a - b).join(',');
  const ok = crypto.createHmac('sha256', SECRET).update('img:' + salt + ':' + exp + ':' + pick).digest('hex').slice(0, 32);
  return sig.length === ok.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(ok)) ? null : 'Výběr nesouhlasí — zkuste novou úlohu.';
}
// Propustka po obou krocích (ověření + obrázky), svázaná s konkrétním řešením „Jsem člověk"
const passFor = (powSalt) => crypto.createHmac('sha256', SECRET).update('pass:' + powSalt).digest('hex').slice(0, 32);
const hits = new Map();
function limited(key, max, ms) {
  const now = Date.now(), arr = (hits.get(key) || []).filter((x) => now - x < ms);
  if (arr.length >= max) { hits.set(key, arr); return true; }
  arr.push(now); hits.set(key, arr); if (hits.size > 5000) hits.clear(); return false;
}

// ─── Validace ────────────────────────────────────────────────────────────────
function normPhone(v) {
  const d = String(v || '').replace(/[^\d+]/g, '');
  if (/^\+\d{9,15}$/.test(d)) return d;
  if (/^00\d{9,15}$/.test(d)) return '+' + d.slice(2);
  if (/^\d{9}$/.test(d)) return '+420' + d;
  return null;
}
// Číslo účtu CZ (předčíslí-číslo/banka, kontrola mod 11) nebo IBAN (mod 97)
function normAccount(v) {
  const raw = String(v || '').replace(/\s/g, '').toUpperCase();
  if (/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(raw)) {
    const r = (raw.slice(4) + raw.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
    let m = 0; for (const ch of r) m = (m * 10 + Number(ch)) % 97;
    return m === 1 ? raw.replace(/(.{4})/g, '$1 ').trim() : null;
  }
  const m = raw.match(/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/);
  if (!m) return null;
  const mod11 = (num, len) => { const w = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1].slice(10 - len); const d = num.padStart(len, '0').split('').map(Number); return d.reduce((a, x, i) => a + x * w[i], 0) % 11 === 0; };
  if (m[1] && !mod11(m[1], 6)) return null;
  if (!mod11(m[2], 10)) return null;
  return (m[1] ? m[1].replace(/^0+/, '') + '-' : '') + m[2].replace(/^0+/, '') + '/' + m[3];
}

async function nextNumber(kind) {
  const prefix = (kind === 'refund' ? 'RV' : 'RD') + new Date().getFullYear() + '-';
  const last = await prisma.washComplaint.findFirst({ where: { number: { startsWith: prefix } }, orderBy: { number: 'desc' }, select: { number: true } });
  const n = last ? parseInt(last.number.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(n).padStart(4, '0');
}
const hist = (row, text, who) => [...(Array.isArray(row && row.history) ? row.history : []), { at: new Date().toISOString(), text, who: who || null }].slice(-100);
const whoOf = (req) => (req.user && (req.user.displayName || req.user.username)) || 'HolyOS';

// ─── Notifikace do Velína + zvonek ───────────────────────────────────────────
async function notifyNew(row) {
  try {
    const { getSetting } = require('../services/settings');
    let ids = await getSetting(NOTIFY_KEY, { type: 'json', defaultValue: null }).catch(() => null);
    if (!Array.isArray(ids) || !ids.length) ids = [1];
    const persons = await prisma.person.findMany({ where: { id: { in: ids.map(Number) } }, select: { id: true, user_id: true } });
    const title = (row.kind === 'refund' ? '💸 Žádost o vrácení platby' : '🧾 Žádost o doklad') + ' — ' + row.number;
    const body = row.place_label + ' · ' + kc(row.amount) + ' · ' + row.customer_name;
    const link = '/modules/servis/index.html?tab=reklamace&id=' + row.id;
    const { notifyPerson } = require('../services/push/expo-push');
    let createNotification = null; try { createNotification = require('./notifications.routes').createNotification; } catch (e) { /* bez zvonku */ }
    for (const p of persons) {
      notifyPerson(prisma, p.id, { title, body, data: { type: 'wash_complaint', id: row.id, link }, sound: 'default' }).catch(() => {});
      if (p.user_id && createNotification) createNotification({ userId: p.user_id, type: 'system', title, body, link }).catch(() => {});
    }
  } catch (e) { console.warn('[wash] notifikace:', e.message); }
}

// ═══ VEŘEJNÉ ═════════════════════════════════════════════════════════════════
// GET /api/public/wash/challenge → výzva pro ověření „Jsem člověk"
publicRouter.get('/challenge', (req, res) => {
  if (limited('pow:' + ipOf(req), 60, 3600e3)) return res.status(429).json({ error: 'Příliš mnoho pokusů, zkuste to prosím později.' });
  res.set('Cache-Control', 'no-store').json(Object.assign({ ok: true }, powChallenge()));
});
// GET /api/public/wash/image-challenge → obrázková úloha
publicRouter.get('/image-challenge', (req, res) => {
  if (limited('img:' + ipOf(req), 40, 3600e3)) return res.status(429).json({ error: 'Příliš mnoho pokusů, zkuste to prosím později.' });
  res.set('Cache-Control', 'no-store').json(Object.assign({ ok: true }, imgChallenge()));
});
// POST /api/public/wash/image-verify { img:{salt,exp,sig,pick}, pow:{…} } → propustka pro odeslání žádosti
publicRouter.post('/image-verify', (req, res) => {
  const b = req.body || {}, ip = ipOf(req);
  if (limited('imgv:' + ip, 3, 60e3) || limited('imgvh:' + ip, 30, 3600e3)) return res.status(429).json({ error: 'Příliš mnoho pokusů — počkejte prosím chvíli.' });
  const e = imgCheck(b.img); if (e) return res.status(400).json({ error: e });
  const p = b.pow || {}, salt = String(p.salt || '');
  if (!/^[a-f0-9]{24}$/.test(salt)) return res.status(400).json({ error: 'Nejdřív potvrďte „Jsem člověk".' });
  res.json({ ok: true, pass: passFor(salt) });
});
// GET /api/public/wash/form → místa, číselníky a token formuláře
publicRouter.get('/form', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json({ ok: true, token: formToken(), places: await loadPlaces(), pay_methods: PAY_METHODS, services: SERVICES, receipt_max: RECEIPT_MAX });
  } catch (e) { res.json({ ok: true, token: formToken(), places: [], pay_methods: PAY_METHODS, services: SERVICES, receipt_max: RECEIPT_MAX }); }
});

// POST /api/public/wash/request
publicRouter.post('/request', async (req, res) => {
  try {
    const b = req.body || {}, ip = ipOf(req);
    // Honeypot: skryté pole „web" vyplní jen robot — tváříme se, že je vše v pořádku
    if (s(b.web, 100)) return res.json({ ok: true, number: '—' });
    const tokErr = checkToken(b.token); if (tokErr) return res.status(400).json({ error: tokErr });
    const powErr = powCheck(b.pow); if (powErr) return res.status(400).json({ error: powErr, pow: true });
    if (!b.pow || String(b.pass || '') !== passFor(String(b.pow.salt || ''))) return res.status(400).json({ error: 'Vyřešte prosím obrázkovou úlohu.', pow: true });
    if (limited('ip:' + ip, 6, 3600e3) || limited('ipd:' + ip, 15, 86400e3)) return res.status(429).json({ error: 'Z tohoto připojení bylo odesláno příliš mnoho žádostí. Zkuste to prosím později, nebo nám zavolejte.' });

    const kind = b.kind === 'refund' ? 'refund' : b.kind === 'receipt' ? 'receipt' : null;
    if (!kind) return res.status(400).json({ error: 'Neznámý typ žádosti.' });
    const err = (m) => res.status(400).json({ error: m });

    // Datum a čas transakce (místní čas), ne v budoucnu a ne starší než 1 rok
    const d = String(b.date || ''), t = String(b.time || '00:00');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) return err('Vyplňte datum a čas transakce.');
    const txAt = new Date(d + 'T' + t + ':00');
    if (isNaN(txAt) || txAt.getTime() > Date.now() + 36e5 || txAt.getTime() < Date.now() - 366 * 864e5) return err('Datum transakce není platné (nesmí být v budoucnu ani starší než rok).');

    const places = await loadPlaces();
    const code = s(b.place_code, 40);
    const place = places.find((p) => p.code === code);
    if (!place) return err('Vyberte místo (prádlomat) ze seznamu.');

    const name = s(b.name, 160); if (name.length < 3) return err('Vyplňte jméno a příjmení / firmu.');
    const phone = normPhone(b.phone); if (!phone) return err('Telefonní číslo není platné.');
    const email = s(b.email, 160).toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return err('E-mail není platný.');
    const amount = Math.round(Number(String(b.amount || '').replace(/\s/g, '').replace(',', '.')) * 100) / 100;
    if (!(amount > 0) || amount > 20000) return err('Zadejte platnou částku v Kč.');
    if (kind === 'receipt' && amount > RECEIPT_MAX) return err('Na jednu žádost o doklad je maximální částka ' + RECEIPT_MAX + ' Kč — pro každou službu či transakci vytvořte samostatnou žádost.');
    const pay = s(b.pay_method, 40); if (!PAY_METHODS.includes(pay)) return err('Vyberte původní způsob platby.');
    const service = s(b.service, 80); if (!SERVICES.includes(service)) return err('Vyberte zakoupenou službu.');
    let account = null, reason = null;
    if (kind === 'refund') {
      account = normAccount(b.account); if (!account) return err('Číslo účtu není platné — zadejte ho ve tvaru 123456789/0100 (případně s předčíslím) nebo jako IBAN.');
      reason = s(b.reason, 2000); if (reason.length < 5) return err('Popište prosím důvod pro vrácení platby.');
    }
    if (limited('mail:' + email, 10, 86400e3)) return res.status(429).json({ error: 'Z tohoto e-mailu bylo dnes odesláno příliš mnoho žádostí. Zkuste to prosím zítra.' });

    let row = null;
    for (let i = 0; i < 3 && !row; i++) {
      try {
        row = await prisma.washComplaint.create({ data: {
          number: await nextNumber(kind), kind, tx_at: txAt, place_code: place.code, place_label: place.label, place_address: place.address || null,
          customer_name: name, phone, email, amount, pay_method: pay, service, account, reason,
          history: [{ at: new Date().toISOString(), text: 'Žádost přijata z formuláře pradlomaty.info/podpora', who: 'zákazník' }],
          ip, user_agent: s(req.headers['user-agent'], 300) || null,
        } });
      } catch (e) { if (e.code !== 'P2002') throw e; }
    }
    if (!row) return res.status(500).json({ error: 'Žádost se nepodařilo uložit, zkuste to prosím znovu.' });
    notifyNew(row);
    // Potvrzení zákazníkovi (s číslem žádosti)
    try {
      const { sendMail } = require('../services/email');
      sendMail({ audience: 'customer', manual: true, to: email, brand: 'pradlomaty', lang: 'cs',
        subject: 'Přijali jsme vaši žádost ' + row.number + ' — ' + KIND_LABEL[kind].toLowerCase(),
        body: 'Dobrý den,\n\nděkujeme, vaši žádost (' + KIND_LABEL[kind].toLowerCase() + ') jsme přijali pod číslem ' + row.number + '.\n\nMísto: ' + place.label + '\nDatum transakce: ' + txAt.toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' }) + '\nČástka: ' + kc(amount) + '\n\nOzveme se vám co nejdříve. Na tuto zprávu můžete odpovědět.\n\nNonstop prádlomat linka: +420 792 319 961',
      }).catch(() => {});
    } catch (e) { /* potvrzení není podmínkou */ }
    res.json({ ok: true, number: row.number });
  } catch (err) {
    console.error('[wash] žádost:', err.message);
    res.status(500).json({ error: 'Žádost se nepodařilo odeslat, zkuste to prosím znovu nebo nám zavolejte.' });
  }
});

// ═══ INTERNÍ ═════════════════════════════════════════════════════════════════
router.use(requireAuth);
router.use(express.json({ limit: '200kb' }));

router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (['refund', 'receipt'].includes(req.query.kind)) where.kind = req.query.kind;
    if (req.query.status) where.status = String(req.query.status);
    const rows = await prisma.washComplaint.findMany({ where, orderBy: { created_at: 'desc' }, take: 2000 });
    const counts = await prisma.washComplaint.groupBy({ by: ['kind', 'status'], _count: { _all: true } }).catch(() => []);
    res.json({ rows, counts: counts.map((c) => ({ kind: c.kind, status: c.status, n: c._count._all })) });
  } catch (err) { next(err); }
});
router.get('/settings', async (req, res, next) => {
  try {
    const { getSetting } = require('../services/settings');
    const ids = await getSetting(NOTIFY_KEY, { type: 'json', defaultValue: [1] }).catch(() => [1]);
    let people = [];
    try { people = await require('../services/shipping/notify').getEligibleVelinPeople(prisma); } catch (e) { /* bez seznamu */ }
    res.json({ notify_person_ids: Array.isArray(ids) ? ids : [1], people, settings: await getSettings(), pay_methods: PAY_METHODS, services: SERVICES, public_url: 'https://pradlomaty.info/podpora' });
  } catch (err) { next(err); }
});
router.put('/settings', async (req, res, next) => {
  try {
    const { setSetting } = require('../services/settings'), b = req.body || {};
    if (Array.isArray(b.notify_person_ids)) await setSetting(NOTIFY_KEY, b.notify_person_ids.map(Number).filter((n) => n > 0), { type: 'json', description: 'Reklamace praní — komu chodí upozornění do Velína', userId: req.user && req.user.id });
    if (b.settings && typeof b.settings === 'object') {
      const cur = await getSettings();
      const vat = Number(b.settings.vat_rate);
      await setSetting(SETTINGS_KEY, Object.assign(cur, { vat_rate: [0, 12, 21].includes(vat) ? vat : cur.vat_rate, receipt_note: s(b.settings.receipt_note, 500) }), { type: 'json', description: 'Reklamace praní — nastavení dokladů', userId: req.user && req.user.id });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});
router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const row = await prisma.washComplaint.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!row) return res.status(404).json({ error: 'Žádost nenalezena' });
    const cn = row.kind === 'refund' ? await findCreditNote(row).catch(() => null) : null;
    res.json(cn ? Object.assign({}, row, { credit_note: { id: cn.id, invoice_number: cn.invoice_number, status: cn.status, total: cn.total, delivery_status: cn.delivery_status } }) : row);
  } catch (err) { next(err); }
});
// PATCH /:id — úprava údajů / interní poznámka / stav (approved, rejected, done, new)
router.patch('/:id(\\d+)', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10), b = req.body || {};
    const row = await prisma.washComplaint.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: 'Žádost nenalezena' });
    const data = {}, zmeny = [];
    if (b.internal_note !== undefined) data.internal_note = s(b.internal_note, 5000) || null;
    if (b.amount !== undefined) { const a = Math.round(Number(String(b.amount).replace(',', '.')) * 100) / 100; if (a > 0) { data.amount = a; zmeny.push('částka ' + kc(a)); } }
    if (b.account !== undefined && row.kind === 'refund') { const acc = normAccount(b.account); if (!acc) return res.status(400).json({ error: 'Číslo účtu není platné.' }); data.account = acc; zmeny.push('účet ' + acc); }
    if (b.email !== undefined) { const em = s(b.email, 160).toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(em)) return res.status(400).json({ error: 'E-mail není platný.' }); data.email = em; zmeny.push('e-mail ' + em); }
    let afterPaid = false;
    if (b.status !== undefined) {
      const st = String(b.status);
      if (!['new', 'approved', 'awaiting_payment', 'rejected', 'done'].includes(st)) return res.status(400).json({ error: 'Neplatný stav' });
      const isRefund = row.kind === 'refund';
      const inv = isRefund ? await findCreditNote(row) : null;
      if (st === 'approved' || st === 'awaiting_payment') {
        if (isRefund) {
          const cn = await ensureCreditNote({ ...row, ...data }, req.user);
          data.status = 'awaiting_payment';
          zmeny.push('schváleno, vystaven dobropis ' + cn.invoice_number + ' — čeká na platbu');
        } else { data.status = 'approved'; zmeny.push('schváleno'); }
      } else if (st === 'done' && isRefund) {
        if (!inv) return res.status(400).json({ error: 'Nejdřív žádost schvalte — tím se vystaví dobropis, který se proplácí.' });
        await markCreditNotePaid(inv);
        data.status = 'done'; data.paid_at = new Date(); data.resolved_at = new Date(); data.resolved_by = whoOf(req);
        zmeny.push('zaplaceno (dobropis ' + inv.invoice_number + ')'); afterPaid = true;
      } else if (st === 'rejected' || st === 'new') {
        if (inv) {
          if (inv.status === 'paid') return res.status(400).json({ error: 'Dobropis ' + inv.invoice_number + ' je už zaplacený — žádost nejde zrušit.' });
          await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'cancelled' } });
          zmeny.push('dobropis ' + inv.invoice_number + ' stornován');
        }
        data.status = st;
        if (st === 'rejected') { data.reject_reason = s(b.reject_reason, 1000) || null; data.resolved_at = new Date(); data.resolved_by = whoOf(req); }
        zmeny.push(st === 'rejected' ? 'zrušeno' + (data.reject_reason ? ' (' + data.reject_reason + ')' : '') : 'vráceno mezi nové');
      } else { // done u dokladu
        data.status = 'done'; data.resolved_at = new Date(); data.resolved_by = whoOf(req); zmeny.push('vyřízeno');
      }
    }
    if (zmeny.length) data.history = hist(row, zmeny.join(', '), whoOf(req));
    const upd = await prisma.washComplaint.update({ where: { id }, data });
    if (afterPaid) sendCreditNoteEmail(upd).catch((e) => console.warn('[wash] e-mail dobropisu:', e.message));
    res.json(upd);
  } catch (err) { next(err); }
});

// ─── Doklad (zjednodušený daňový doklad) ─────────────────────────────────────
async function receiptData(row) {
  const our = await require('../services/settings').getOurCompany().catch(() => null) || {};
  const st = await getSettings();
  const vat = Number(st.vat_rate) || 0, total = Number(row.amount);
  const base = Math.round(total / (1 + vat / 100) * 100) / 100;
  return { our, vat, total, base, vatAmount: Math.round((total - base) * 100) / 100, note: st.receipt_note || '' };
}
function receiptHtml(row, d, number) {
  const bs2 = require('../services/pdf/bs2-doc-style');
  const our = d.our || {};
  const adresa = [our.address, [our.zip, our.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const tx = new Date(row.tx_at);
  const body = '<div class="parties"><div class="party"><span class="h">Prodávající</span><div class="name">' + esc(our.name || 'Best Series s.r.o.') + '</div>'
    + (adresa ? '<div class="row">' + esc(adresa) + '</div>' : '')
    + ((our.ico || our.dic) ? '<div class="row">' + (our.ico ? 'IČO: ' + esc(our.ico) : '') + (our.dic ? ' · DIČ: ' + esc(our.dic) : '') + '</div>' : '') + '</div>'
    + '<div class="party"><span class="h">Zákazník</span><div class="name">' + esc(row.customer_name) + '</div><div class="row">' + esc(row.email) + '</div></div></div>'
    + '<div class="meta"><div><div class="l">Datum uskutečnění plnění</div><div class="v">' + tx.toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</div></div>'
    + '<div><div class="l">Datum vystavení</div><div class="v">' + new Date().toLocaleDateString('cs-CZ') + '</div></div>'
    + '<div><div class="l">Způsob platby</div><div class="v">' + esc(row.pay_method) + '</div></div>'
    + '<div><div class="l">Místo</div><div class="v">' + esc(row.place_label) + '</div></div></div>'
    + '<table class="items"><thead><tr><th class="r">#</th><th>Služba</th><th class="r">Základ</th><th class="r">DPH ' + d.vat + ' %</th><th class="r">Celkem</th></tr></thead><tbody>'
    + '<tr><td class="c">1</td><td class="d">' + esc(row.service) + '<span class="code">samoobslužný prádlomat — ' + esc(row.place_label) + (row.place_address ? ', ' + esc(row.place_address) : '') + '</span></td>'
    + '<td class="r">' + kc(d.base) + '</td><td class="r">' + kc(d.vatAmount) + '</td><td class="r"><b>' + kc(d.total) + '</b></td></tr></tbody></table>'
    + '<div class="note"><strong>Celkem uhrazeno: ' + kc(d.total) + '</strong> · uhrazeno ' + esc(row.pay_method.toLowerCase()) + ' v prádlomatu. Doklad vystaven na žádost zákazníka ' + esc(row.number) + '.' + (d.note ? '<br>' + esc(d.note) : '') + '</div>';
  return bs2.page({ title: 'Zjednodušený daňový doklad', number, pill: 'Prádlomat' }, body);
}
// ─── Dobropis k vrácení platby ───────────────────────────────────────────────
// Schválená žádost o vrácení platby vystaví dobropis (Invoice type credit_note_issued, source wash_refund).
// Dobropis je závazek vůči zákazníkovi → vede se ve směru "ap" (kladná částka), takže se objeví v Účetních
// dokladech → K platbě, jde do platebního příkazu a bankovní auto-matcher ho spáruje (VS = číslo žádosti, účet,
// částka). Po zaplacení (z banky i ručně) se žádost sama překlopí do „Zaplaceno" a zákazník dostane dobropis e-mailem.
const vsOf = (number) => String(number || '').replace(/\D/g, '').slice(0, 10);
async function findCreditNote(row) {
  return prisma.invoice.findFirst({ where: { source: 'wash_refund', external_number: row.number, status: { not: 'cancelled' } }, include: { items: true, company: true }, orderBy: { id: 'desc' } });
}
async function ensureCreditNote(row, user) {
  const ex = await findCreditNote(row); if (ex) return ex;
  const st = await getSettings(), vat = Number(st.vat_rate) || 0, total = Number(row.amount);
  const base = Math.round(total / (1 + vat / 100) * 100) / 100, vatAmount = Math.round((total - base) * 100) / 100;
  // Zákazník jako firma v adresáři (podle e-mailu), ať se dobropis i platba vážou na stejný záznam
  let company = await prisma.company.findFirst({ where: { email: { equals: row.email, mode: 'insensitive' }, type: { in: ['customer', 'both'] } } });
  if (!company) company = await prisma.company.create({ data: { name: row.customer_name.slice(0, 255), type: 'customer', email: row.email, phone: String(row.phone || '').slice(0, 20), bank_account: row.account ? String(row.account).slice(0, 50) : null, notes: 'Zákazník prádlomatu — vrácení platby ' + row.number } });
  const { generateInvoiceNumber } = require('../services/accountant/invoice-numbering');
  const tx = new Date(row.tx_at), popis = 'Vrácení platby — ' + row.service + ', ' + row.place_label + ', transakce ' + tx.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' });
  const due = new Date(); due.setDate(due.getDate() + 3);
  const inv = await prisma.$transaction(async (t) => {
    const number = await generateInvoiceNumber('credit_note_issued', { prisma: t });
    return t.invoice.create({ data: {
      invoice_number: number, external_number: row.number, type: 'credit_note_issued', direction: 'ap', invoice_role: 'refund', source: 'wash_refund',
      company_id: company.id, currency: 'CZK', subtotal: base.toFixed(2), vat_amount: vatAmount.toFixed(2), total: total.toFixed(2),
      vat_regime: vat ? 'standard' : 'non_vat_payer', date_issued: new Date(), date_taxable: tx, date_due: due,
      payment_method: 'bank_transfer', variable_symbol: vsOf(row.number), partner_bank_account: row.account || null,
      status: 'ready_to_pay', payment_note: 'Vrácení platby ' + row.number,
      note: 'Dobropis k žádosti o vrácení platby ' + row.number + (row.reason ? ' — ' + String(row.reason).slice(0, 300) : ''),
      created_by_user_id: (user && user.id) || null,
      items: { create: [{ line_order: 1, description: popis.slice(0, 500), quantity: 1, unit: 'ks', unit_price: base.toFixed(4), vat_rate: vat, subtotal: base.toFixed(2), vat_amount: vatAmount.toFixed(2), total: total.toFixed(2) }] },
    }, include: { items: true, company: true } });
  });
  return inv;
}
async function markCreditNotePaid(inv) {
  if (inv.status === 'paid') return inv;
  return prisma.invoice.update({ where: { id: inv.id }, data: { status: 'paid', paid_amount: inv.total } });
}
function creditNoteHtml(row, inv, d) {
  const bs2 = require('../services/pdf/bs2-doc-style');
  const our = d.our || {}, adresa = [our.address, [our.zip, our.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const tx = new Date(row.tx_at), neg = (n) => kc(-Math.abs(Number(n)));
  const body = '<div class="parties"><div class="party"><span class="h">Vystavil</span><div class="name">' + esc(our.name || 'Best Series s.r.o.') + '</div>'
    + (adresa ? '<div class="row">' + esc(adresa) + '</div>' : '')
    + ((our.ico || our.dic) ? '<div class="row">' + (our.ico ? 'IČO: ' + esc(our.ico) : '') + (our.dic ? ' · DIČ: ' + esc(our.dic) : '') + '</div>' : '') + '</div>'
    + '<div class="party"><span class="h">Zákazník</span><div class="name">' + esc(row.customer_name) + '</div><div class="row">' + esc(row.email) + '</div></div></div>'
    + '<div class="meta"><div><div class="l">Datum vystavení</div><div class="v">' + new Date(inv.date_issued).toLocaleDateString('cs-CZ') + '</div></div>'
    + '<div><div class="l">Původní transakce</div><div class="v">' + tx.toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</div></div>'
    + '<div><div class="l">Vrácení na účet</div><div class="v">' + esc(row.account || '—') + '</div></div>'
    + '<div><div class="l">Variabilní symbol</div><div class="v">' + esc(inv.variable_symbol || '') + '</div></div></div>'
    + '<table class="items"><thead><tr><th class="r">#</th><th>Položka</th><th class="r">Základ</th><th class="r">DPH ' + d.vat + ' %</th><th class="r">Celkem</th></tr></thead><tbody>'
    + '<tr><td class="c">1</td><td class="d">Vrácení platby — ' + esc(row.service) + '<span class="code">' + esc(row.place_label) + (row.place_address ? ', ' + esc(row.place_address) : '') + ' · k žádosti ' + esc(row.number) + '</span></td>'
    + '<td class="r">' + neg(inv.subtotal) + '</td><td class="r">' + neg(inv.vat_amount) + '</td><td class="r"><b>' + neg(inv.total) + '</b></td></tr></tbody></table>'
    + '<div class="note"><strong>Vráceno zákazníkovi: ' + kc(inv.total) + '</strong> bankovním převodem na účet ' + esc(row.account || '') + '. Dobropis vystaven k žádosti o vrácení platby ' + esc(row.number) + '.' + (d.note ? '<br>' + esc(d.note) : '') + '</div>';
  return bs2.page({ title: 'Dobropis', number: inv.invoice_number, pill: 'Vrácení platby' }, body);
}
async function creditNotePdf(row, inv) { return pdfFromHtml(creditNoteHtml(row, inv, await receiptData(row))); }
// E-mail zákazníkovi s dobropisem (po zaplacení). Bezpečné volat opakovaně — pošle se jen jednou.
async function sendCreditNoteEmail(row) {
  const inv = await prisma.invoice.findFirst({ where: { source: 'wash_refund', external_number: row.number, status: { not: 'cancelled' } }, orderBy: { id: 'desc' } });
  if (!inv) return { ok: false, reason: 'no_credit_note' };
  if (inv.delivery_status === 'sent') return { ok: true, already: true };
  const pdf = await creditNotePdf(row, inv);
  const { sendMail } = require('../services/email');
  const r = await sendMail({ audience: 'customer', manual: true, to: row.email, brand: 'pradlomaty', lang: 'cs',
    subject: 'Vrátili jsme vám platbu — dobropis ' + inv.invoice_number,
    body: 'Dobrý den,\n\nvaši platbu ' + kc(inv.total) + ' (' + row.place_label + ', ' + new Date(row.tx_at).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' }) + ') jsme vám vrátili na účet ' + (row.account || '') + '. Podle banky může připsání trvat jeden pracovní den.\n\nV příloze zasíláme dobropis ' + inv.invoice_number + ' k vaší žádosti ' + row.number + '.\n\nDěkujeme za trpělivost.\nNonstop prádlomat linka: +420 792 319 961',
    attachments: [{ filename: inv.invoice_number + '.pdf', content: Buffer.from(pdf), contentType: 'application/pdf' }] });
  if (!r || !r.sent) { await prisma.invoice.update({ where: { id: inv.id }, data: { delivery_status: 'failed', send_error: String((r && (r.error || r.skipped)) || 'unknown').slice(0, 500), sent_to: row.email } }); return { ok: false, reason: 'send_failed' }; }
  await prisma.invoice.update({ where: { id: inv.id }, data: { delivery_status: 'sent', sent_at: new Date(), sent_to: row.email, send_error: null } });
  const cur = await prisma.washComplaint.findUnique({ where: { id: row.id } });
  await prisma.washComplaint.update({ where: { id: row.id }, data: { receipt_number: inv.invoice_number, receipt_sent_at: new Date(), history: hist(cur, 'Dobropis ' + inv.invoice_number + ' odeslán na ' + row.email, 'HolyOS') } });
  return { ok: true };
}
// Voláno po spárování bankovní platby: zaplacený dobropis → žádost „Zaplaceno" + e-mail zákazníkovi
async function processPaymentForRefunds(paymentId) {
  try {
    const allocs = await prisma.paymentAllocation.findMany({ where: { payment_id: paymentId }, include: { invoice: { select: { id: true, status: true, source: true, external_number: true } } } });
    for (const a of allocs) {
      const inv = a.invoice; if (!inv || inv.source !== 'wash_refund' || inv.status !== 'paid') continue;
      const row = await prisma.washComplaint.findUnique({ where: { number: inv.external_number } });
      if (!row || row.status === 'done') continue;
      const upd = await prisma.washComplaint.update({ where: { id: row.id }, data: { status: 'done', paid_at: new Date(), resolved_at: new Date(), resolved_by: 'banka (automaticky)', history: hist(row, 'zaplaceno — platba spárována s dobropisem (automaticky z banky)', 'HolyOS') } });
      sendCreditNoteEmail(upd).catch((e) => console.warn('[wash] e-mail dobropisu:', e.message));
    }
  } catch (e) { console.warn('[wash] processPaymentForRefunds:', e.message); }
}

let _browser = null;
async function pdfFromHtml(html) {
  if (!_browser || !_browser.isConnected()) _browser = await require('puppeteer').launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'] });
  const page = await _browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const st = require('../services/pdf/bs2-doc-style');
    await st.preparePdfPage(page);
    return await page.pdf(st.PDF_OPTIONS);
  } finally { await page.close().catch(() => {}); }
}
async function receiptNumber(row) {
  if (row.receipt_number) return row.receipt_number;
  const prefix = 'DP' + new Date().getFullYear() + '-';
  const last = await prisma.washComplaint.findFirst({ where: { receipt_number: { startsWith: prefix } }, orderBy: { receipt_number: 'desc' }, select: { receipt_number: true } });
  return prefix + String(last ? parseInt(last.receipt_number.slice(prefix.length), 10) + 1 : 1).padStart(5, '0');
}
// GET /:id/receipt.pdf — náhled dokladu (číslo se přidělí až při odeslání)
router.get('/:id(\\d+)/receipt.pdf', async (req, res, next) => {
  try {
    const row = await prisma.washComplaint.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!row || row.kind !== 'receipt') return res.status(404).json({ error: 'Žádost o doklad nenalezena' });
    const pdf = await pdfFromHtml(receiptHtml(row, await receiptData(row), row.receipt_number || 'NÁHLED'));
    res.set('Content-Type', 'application/pdf').set('Content-Disposition', 'inline; filename="' + (row.receipt_number || 'nahled-' + row.number) + '.pdf"').send(Buffer.from(pdf));
  } catch (err) { next(err); }
});
// POST /:id/send-receipt — přidělí číslo, vygeneruje PDF a pošle zákazníkovi (lze i znovu)
router.post('/:id(\\d+)/send-receipt', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await prisma.washComplaint.findUnique({ where: { id } });
    if (!row || row.kind !== 'receipt') return res.status(404).json({ error: 'Žádost o doklad nenalezena' });
    if (row.status === 'rejected') return res.status(400).json({ error: 'Zamítnutou žádost nejde vyřídit — nejdřív ji vraťte mezi nové.' });
    const number = await receiptNumber(row);
    const pdf = await pdfFromHtml(receiptHtml(row, await receiptData(row), number));
    const { sendMail } = require('../services/email');
    const r = await sendMail({ audience: 'customer', manual: true, to: row.email, brand: 'pradlomaty', lang: 'cs',
      subject: 'Doklad k vaší platbě v prádlomatu — ' + number,
      body: 'Dobrý den,\n\nv příloze posíláme doklad k vaší platbě ze dne ' + new Date(row.tx_at).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' }) + ' (' + row.place_label + ', ' + kc(row.amount) + ').\n\nDěkujeme, že využíváte naše prádlomaty.',
      attachments: [{ filename: number + '.pdf', content: Buffer.from(pdf), contentType: 'application/pdf' }] });
    if (!r || !r.sent) return res.status(502).json({ error: 'E-mail se nepodařilo odeslat: ' + ((r && (r.error || r.skipped)) || 'neznámá chyba') });
    const upd = await prisma.washComplaint.update({ where: { id }, data: { receipt_number: number, receipt_sent_at: new Date(), status: 'done', resolved_at: new Date(), resolved_by: whoOf(req),
      history: hist(row, 'Doklad ' + number + ' odeslán na ' + row.email, whoOf(req)) } });
    res.json(upd);
  } catch (err) { next(err); }
});
// POST /:id/email — vlastní zpráva zákazníkovi (např. „platbu jsme vrátili", dotaz na upřesnění)
router.post('/:id(\\d+)/email', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10), text = s((req.body || {}).text, 5000);
    const row = await prisma.washComplaint.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: 'Žádost nenalezena' });
    if (text.length < 5) return res.status(400).json({ error: 'Napište text zprávy.' });
    const { sendMail } = require('../services/email');
    const r = await sendMail({ audience: 'customer', manual: true, to: row.email, brand: 'pradlomaty', lang: 'cs', subject: 'Vaše žádost ' + row.number, body: text });
    if (!r || !r.sent) return res.status(502).json({ error: 'E-mail se nepodařilo odeslat: ' + ((r && (r.error || r.skipped)) || 'neznámá chyba') });
    const upd = await prisma.washComplaint.update({ where: { id }, data: { history: hist(row, 'E-mail zákazníkovi: ' + text.slice(0, 300), whoOf(req)) } });
    res.json(upd);
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.publicRouter = publicRouter;
module.exports.processPaymentForRefunds = processPaymentForRefunds;
module.exports.sendCreditNoteEmail = sendCreditNoteEmail;
module.exports._test = { normPhone, normAccount, checkToken, formToken, powChallenge, powCheck, imgChallenge, imgCheck, passFor };
