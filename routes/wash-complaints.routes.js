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
    res.json(row);
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
    if (b.status !== undefined) {
      const st = String(b.status);
      if (!['new', 'approved', 'rejected', 'done'].includes(st)) return res.status(400).json({ error: 'Neplatný stav' });
      data.status = st;
      if (st === 'rejected') { data.reject_reason = s(b.reject_reason, 1000) || null; }
      if (st === 'done' && row.kind === 'refund') data.paid_at = new Date();
      if (['rejected', 'done'].includes(st)) { data.resolved_at = new Date(); data.resolved_by = whoOf(req); }
      zmeny.push({ new: 'vráceno mezi nové', approved: 'schváleno', rejected: 'zamítnuto' + (data.reject_reason ? ' (' + data.reject_reason + ')' : ''), done: row.kind === 'refund' ? 'vyplaceno' : 'vyřízeno' }[st]);
    }
    if (zmeny.length) data.history = hist(row, zmeny.join(', '), whoOf(req));
    const upd = await prisma.washComplaint.update({ where: { id }, data });
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
module.exports._test = { normPhone, normAccount, checkToken, formToken };
