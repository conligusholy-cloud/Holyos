// =============================================================================
// HolyOS — Laundromat Tycoon: e-mailing (kontakty, jednorázové a pravidelné kampaně)
// =============================================================================
// Připojeno na /api/game-admin/mailing (před game-admin.routes, ať se nezachytí dřív).
// Smí sem stejný okruh lidí jako do administrace hry.
const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { Prisma } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');
const GM = require('../services/game/mailing');

router.use(express.json({ limit: '12mb' }));
router.use(requireAuth);

function allowed(user) {
  const person = user && user.person;
  if (!person) return false;
  const ids = String(process.env.GAME_ADMIN_PERSON_IDS || process.env.BS2_ALLOWED_PERSON_IDS || '')
    .split(',').map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite);
  if (ids.length) return ids.includes(person.id);
  const fn = String(person.first_name || '').trim().toLowerCase();
  const ln = String(person.last_name || '').trim().toLowerCase();
  return ln === 'holý' && (fn === 'tomáš' || fn === 'jan');
}
router.use((req, res, next) => {
  if (!allowed(req.user)) return res.status(403).json({ error: 'Do této sekce nemáš přístup.' });
  next();
});

const str = (v, n) => { const s = String(v == null ? '' : v).trim(); return s ? s.slice(0, n) : null; };
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const who = (req) => { const p = req.user && req.user.person; return p ? ((p.first_name || '') + ' ' + (p.last_name || '')).trim().slice(0, 120) : null; };

// ── Odesílatelé (SES) ─────────────────────────────────────────────
router.get('/senders', wrap(async (req, res) => {
  const M = require('../services/ses/mailer');
  const list = M.isConfigured() ? (await M.sesSenders()).map((x) => ({ address: x.address, name: x.name || '', domain: x.domain })) : [];
  res.json({ senders: list, configured: M.isConfigured(), default: process.env.GM_MAIL_FROM || null, game_url: GM.GAME_URL, tracking: !!process.env.SES_CONFIGURATION_SET });
}));

// ── Kontakty ──────────────────────────────────────────────────────
function contactWhere(q) {
  const where = {};
  if (q.status && ['active', 'unsubscribed', 'bounced', 'excluded'].includes(String(q.status))) where.status = String(q.status);
  if (q.tag) where.tags = { contains: String(q.tag).trim(), mode: 'insensitive' };
  ['stage', 'kind', 'country'].forEach((f) => { if (q[f]) where[f] = String(q[f]) === '(prázdné)' ? null : String(q[f]); });
  const s = String(q.q || '').trim();
  if (s) where.OR = ['email', 'first_name', 'last_name', 'company', 'phone'].map((f) => ({ [f]: { contains: s, mode: 'insensitive' } }));
  return where;
}
router.get('/contacts', wrap(async (req, res) => {
  const where = contactWhere(req.query);
  const take = req.query.all ? 50000 : Math.min(200, parseInt(req.query.limit, 10) || 100), skip = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const [total, items, byStatus, tagRows, extraKeys] = await Promise.all([
    prisma.gameMailContact.count({ where }),
    prisma.gameMailContact.findMany({ where, orderBy: { id: 'desc' }, take, skip }),
    prisma.gameMailContact.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.gameMailContact.findMany({ where: { tags: { not: null } }, select: { tags: true }, distinct: ['tags'], take: 5000 }),
    prisma.gameMailContact.findMany({ where: { extra: { not: null } }, select: { extra: true }, take: 50 }),
  ]);
  const tags = {}; tagRows.forEach((r) => String(r.tags || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean).forEach((t) => { tags[t] = 1; }));
  const keys = {}; extraKeys.forEach((r) => Object.keys(r.extra || {}).forEach((k) => { keys[k] = 1; }));
  const counts = { active: 0, unsubscribed: 0, bounced: 0, excluded: 0 }; byStatus.forEach((b) => { counts[b.status] = b._count._all; });
  res.json({ total, items, counts, tags: Object.keys(tags).sort(), extra_keys: Object.keys(keys) });
}));

function parseDate(v) {
  const t = String(v == null ? '' : v).trim(); if (!t) return undefined;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t); let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; } else if ((m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/.exec(t))) { d = +m[1]; mo = +m[2]; y = +m[3]; } else return undefined;
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return new Date(Date.UTC(y, mo - 1, d));
}
function contactData(b) {
  const pe = GM.parseEmails(b.email); const email = pe.email; if (!email) return { error: 'Neplatný e-mail' };
  const ex0 = b.extra && typeof b.extra === 'object' && !Array.isArray(b.extra) ? Object.assign({}, b.extra) : {};
  if (pe.others.length) ex0['Další e-maily'] = pe.others.join(', ');
  const extra = Object.fromEntries(Object.entries(ex0).slice(0, 60).map(([k, v]) => [String(k).slice(0, 60), String(v == null ? '' : v).slice(0, 500)]).filter(([k, v]) => k && v !== ''));
  const country = GM.cleanText(b.country, 80);
  let lang = String(b.lang || '').trim().toLowerCase().slice(0, 2);
  if (!GM.LANGS.includes(lang)) lang = GM.langFromCountry(country) || '';
  const acq = parseDate(b.acquired_at != null ? b.acquired_at : b.acquired);
  return { data: { email, email_lower: email.toLowerCase(), first_name: GM.cleanText(b.first_name, 100), last_name: GM.cleanText(b.last_name, 100), company: GM.cleanText(b.company, 200), phone: GM.cleanText(b.phone, 60), lang: lang || null, stage: GM.cleanText(b.stage, 60), kind: GM.cleanText(b.kind, 80), country, acquired_at: acq || null, ext_id: GM.cleanText(b.ext_id, 40), tags: str(Array.isArray(b.tags) ? b.tags.join(',') : b.tags, 300), extra: Object.keys(extra).length ? extra : undefined, source: str(b.source, 80) } };
}

router.post('/contacts', wrap(async (req, res) => {
  const c = contactData(req.body || {}); if (c.error) return res.status(400).json({ error: c.error });
  const ex = await prisma.gameMailContact.findUnique({ where: { email_lower: c.data.email_lower } });
  if (ex) return res.status(409).json({ error: 'Kontakt s tímto e-mailem už existuje.' });
  c.data.source = c.data.source || 'ručně';
  res.status(201).json(await prisma.gameMailContact.create({ data: c.data }));
}));
router.put('/contacts/:id(\\d+)', wrap(async (req, res) => {
  const c = contactData(req.body || {}); if (c.error) return res.status(400).json({ error: c.error });
  const id = parseInt(req.params.id, 10);
  const dup = await prisma.gameMailContact.findFirst({ where: { email_lower: c.data.email_lower, NOT: { id } } });
  if (dup) return res.status(409).json({ error: 'Jiný kontakt už má tento e-mail.' });
  const data = Object.assign({}, c.data); delete data.source;
  const st = String((req.body || {}).status || ''); if (['active', 'unsubscribed', 'bounced', 'excluded'].includes(st)) data.status = st;
  // Json pole: prázdné = smazat (Prisma.DbNull), nepřítomné v těle = nechat být
  if (data.extra === undefined && req.body && req.body.extra && typeof req.body.extra === 'object') data.extra = Prisma.DbNull;
  res.json(await prisma.gameMailContact.update({ where: { id }, data }));
}));
router.delete('/contacts/:id(\\d+)', wrap(async (req, res) => { await prisma.gameMailContact.deleteMany({ where: { id: parseInt(req.params.id, 10) } }); res.json({ ok: true }); }));

// Hromadně: smazat / nastavit stav / přidat štítek — buď pro vybraná id, nebo pro celý aktuální filtr
router.post('/contacts/bulk', wrap(async (req, res) => {
  const b = req.body || {}; const action = String(b.action || '');
  let where;
  if (Array.isArray(b.ids) && b.ids.length) where = { id: { in: b.ids.map((x) => parseInt(x, 10)).filter(Number.isFinite).slice(0, 50000) } };
  else if (b.all) where = contactWhere(b.filter || {});
  else return res.status(400).json({ error: 'Nic není vybráno.' });
  if (action === 'delete') { const r = await prisma.gameMailContact.deleteMany({ where }); return res.json({ ok: true, count: r.count }); }
  if (action === 'status') { const st = String(b.status || ''); if (!['active', 'unsubscribed', 'bounced', 'excluded'].includes(st)) return res.status(400).json({ error: 'Neplatný stav' }); const r = await prisma.gameMailContact.updateMany({ where, data: { status: st } }); return res.json({ ok: true, count: r.count }); }
  if (action === 'tag') {
    const tag = str(b.tag, 40); if (!tag) return res.status(400).json({ error: 'Chybí štítek' });
    const rows = await prisma.gameMailContact.findMany({ where, select: { id: true, tags: true }, take: 50000 }); let n = 0;
    for (const r of rows) { const have = String(r.tags || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean); if (have.some((x) => x.toLowerCase() === tag.toLowerCase())) continue; await prisma.gameMailContact.update({ where: { id: r.id }, data: { tags: have.concat([tag]).join(',').slice(0, 300) } }); n++; }
    return res.json({ ok: true, count: n });
  }
  res.status(400).json({ error: 'Neznámá akce' });
}));

// Import: klient pošle už namapované řádky po dávkách (viz mailing.js).
// mode: upsert = doplnit i existující, skip = přeskočit existující; exclude_stages = hodnoty „Stav“, jejichž kontakty se uloží jako vyřazené (nezasílat)
router.post('/contacts/import', wrap(async (req, res) => {
  const b = req.body || {}; const rows = Array.isArray(b.rows) ? b.rows.slice(0, 3000) : [];
  const mode = b.mode === 'skip' ? 'skip' : 'upsert'; const tag = str(b.tag, 40); const source = str(b.source, 80) || 'import';
  const excl = new Set((Array.isArray(b.exclude_stages) ? b.exclude_stages : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean));
  const sup = await GM.suppressedSet();
  const t = { created: 0, updated: 0, skipped: 0, invalid: 0, blocked: 0, excluded: 0, multi: 0 };
  for (const raw of rows) {
    const c = contactData(Object.assign({}, raw, { source })); if (c.error) { t.invalid++; continue; }
    if (c.data.extra && c.data.extra['Další e-maily']) t.multi++;
    const lo = c.data.email_lower; const isExcl = !!(c.data.stage && excl.has(c.data.stage.toLowerCase()));
    const ex = await prisma.gameMailContact.findUnique({ where: { email_lower: lo } });
    const tags = Array.from(new Set(String(c.data.tags || '').split(/[,;]/).concat(tag ? [tag] : []).map((x) => x.trim()).filter(Boolean))).join(',').slice(0, 300) || null;
    if (!ex) {
      const isSup = sup.has(lo); if (isSup) t.blocked++; else if (isExcl) t.excluded++;
      await prisma.gameMailContact.create({ data: Object.assign({}, c.data, { tags, status: isSup ? 'unsubscribed' : (isExcl ? 'excluded' : 'active') }) }); t.created++; continue;
    }
    if (mode === 'skip') { t.skipped++; continue; }
    const merged = Object.assign({}, c.data.extra || {}, ex.extra || {});
    const exTags = String(ex.tags || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    const allTags = Array.from(new Set(exTags.concat(String(tags || '').split(',').filter(Boolean)))).join(',').slice(0, 300) || null;
    const upd = { first_name: ex.first_name || c.data.first_name, last_name: ex.last_name || c.data.last_name, company: ex.company || c.data.company, phone: ex.phone || c.data.phone, lang: ex.lang || c.data.lang, stage: ex.stage || c.data.stage, kind: ex.kind || c.data.kind, country: ex.country || c.data.country, acquired_at: ex.acquired_at || c.data.acquired_at, ext_id: ex.ext_id || c.data.ext_id, extra: Object.keys(merged).length ? merged : undefined, tags: allTags };
    // vyřazení vítězí: pokud je kterýkoli záznam téhož e-mailu „nezasílat“, kontakt se nesmí oslovovat
    if (isExcl && ex.status === 'active') { upd.status = 'excluded'; t.excluded++; }
    await prisma.gameMailContact.update({ where: { id: ex.id }, data: upd });
    t.updated++;
  }
  res.json(Object.assign({ ok: true }, t));
}));

// Hodnoty polí z CRM s počty (pro filtry kampaní): jen aktivní kontakty
router.get('/contacts/facets', wrap(async (req, res) => {
  const out = {};
  for (const f of ['stage', 'kind', 'country']) {
    const g = await prisma.gameMailContact.groupBy({ by: [f], where: { status: 'active' }, _count: { _all: true } });
    out[f] = g.map((x) => ({ v: x[f] || '(prázdné)', n: x._count._all })).sort((a, b) => b.n - a.n);
  }
  res.json(out);
}));

// ── Kampaně ───────────────────────────────────────────────────────
function cleanAudience(a) {
  a = a && typeof a === 'object' ? a : {};
  const arr = (x) => (Array.isArray(x) ? x : []).map((v) => String(v).trim().slice(0, 80)).filter(Boolean).slice(0, 60);
  return { contacts: a.contacts !== false, tag: str(a.tag, 120) || '', stages: arr(a.stages), kinds: arr(a.kinds), countries: arr(a.countries), players: !!a.players, player_lang: str(a.player_lang, 5) || '' };
}
function cleanSchedule(kind, s) {
  s = s && typeof s === 'object' ? s : {};
  if (kind === 'recurring') return { freq: ['daily', 'weekly', 'monthly'].includes(s.freq) ? s.freq : 'weekly', dow: Math.min(7, Math.max(1, parseInt(s.dow, 10) || 1)), dom: Math.min(28, Math.max(1, parseInt(s.dom, 10) || 1)), hour: Math.min(23, Math.max(0, Number.isFinite(parseInt(s.hour, 10)) ? parseInt(s.hour, 10) : 9)) };
  if (kind === 'oneoff') { const d = s.at ? new Date(s.at) : null; return d && !isNaN(d) ? { at: d.toISOString() } : {}; }
  return {};
}
function cleanSteps(steps) {
  return (Array.isArray(steps) ? steps : []).slice(0, 15).map((s) => ({ day: Math.min(3650, Math.max(0, parseInt(s && s.day, 10) || 0)), subject: str(s && s.subject, 300) || '', body: String((s && s.body) || '').slice(0, 20000) })).filter((s) => s.subject || s.body);
}
function campaignData(b, kind) {
  const d = {
    name: str(b.name, 160) || 'Bez názvu', subject: str(b.subject, 300) || '', body: String(b.body || '').slice(0, 20000),
    link: b.link && /^https:\/\//.test(String(b.link).trim()) ? String(b.link).trim().slice(0, 500) : null, link_label: str(b.link_label, 80),
    image_url: b.image_url && /^https:\/\//.test(String(b.image_url).trim()) ? String(b.image_url).trim().slice(0, 500) : null,
    translations: b.translations && typeof b.translations === 'object' && !Array.isArray(b.translations) && JSON.stringify(b.translations).length < 400000 ? b.translations : undefined,
    from_address: str(b.from_address, 200), from_name: str(b.from_name, 100), reply_to: GM.cleanEmail(b.reply_to) || null,
    lang: GM.LANGS.includes(String(b.lang || '')) ? String(b.lang) : 'cs', audience: cleanAudience(b.audience), schedule: cleanSchedule(kind, b.schedule),
  };
  if (kind === 'sequence') d.steps = cleanSteps(b.steps);
  return d;
}
const KINDS = ['oneoff', 'recurring', 'sequence'];

router.get('/campaigns', wrap(async (req, res) => {
  const where = KINDS.includes(String(req.query.kind)) ? { kind: String(req.query.kind) } : {};
  res.json({ items: await prisma.gameMailCampaign.findMany({ where, orderBy: { id: 'desc' }, take: 300 }) });
}));
router.get('/campaigns/:id(\\d+)', wrap(async (req, res) => {
  const c = await prisma.gameMailCampaign.findUnique({ where: { id: parseInt(req.params.id, 10) } });
  if (!c) return res.status(404).json({ error: 'Kampaň nenalezena' }); res.json(c);
}));
router.post('/campaigns', wrap(async (req, res) => {
  const kind = String((req.body || {}).kind || ''); if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Neplatný typ kampaně' });
  const data = campaignData(req.body || {}, kind); data.kind = kind; data.created_by = who(req);
  res.status(201).json(await prisma.gameMailCampaign.create({ data }));
}));
router.put('/campaigns/:id(\\d+)', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10); const c = await prisma.gameMailCampaign.findUnique({ where: { id } });
  if (!c) return res.status(404).json({ error: 'Kampaň nenalezena' });
  if (c.kind === 'oneoff' && ['sending', 'sent'].includes(c.status)) return res.status(409).json({ error: 'Odeslanou kampaň už nejde upravit — vytvoř novou.' });
  const data = campaignData(req.body || {}, c.kind);
  // změna rozvrhu u aktivní pravidelné kampaně → přepočítat další termín
  if (c.kind === 'recurring' && c.status === 'active') data.next_run_at = GM.nextRun(data.schedule, new Date());
  if (c.kind === 'oneoff' && c.status === 'scheduled') { const at = data.schedule && data.schedule.at ? new Date(data.schedule.at) : null; data.next_run_at = at; }
  res.json(await prisma.gameMailCampaign.update({ where: { id }, data }));
}));
router.delete('/campaigns/:id(\\d+)', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await prisma.gameMailSend.deleteMany({ where: { campaign_id: id } }); await prisma.gameMailCampaign.deleteMany({ where: { id } }); res.json({ ok: true });
}));

// ── Rozpracovaná kampaň (bez uložení): náhled e-mailu, testovací odeslání, AI návrh, obrázek ──
function draftOf(b) { const kind = KINDS.includes(String(b.kind)) ? String(b.kind) : 'oneoff'; const d = campaignData(b, kind); d.kind = kind; d.id = 0; return d; }
const SAMPLE = () => GM.contactVars({ first_name: 'Jana', last_name: 'Nováková', company: 'Ukázka s.r.o.', email: 'jana.novakova@example.com', phone: '+420 600 000 000' });
router.post('/preview', wrap(async (req, res) => {
  const c = draftOf(req.body || {}), si = Math.max(0, parseInt((req.body || {}).step, 10) || 0);
  const st = c.kind === 'sequence' && Array.isArray(c.steps) && c.steps.length ? (c.steps[si] || c.steps[0]) : { subject: c.subject, body: c.body };
  // náhled v jazyce příjemce: chybějící překlad se dopočítá (vrací se klientovi a uloží se s kampaní)
  const vl = GM.LANGS.includes(String((req.body || {}).view_lang)) ? String(req.body.view_lang) : GM.baseLang(c);
  if (vl !== GM.baseLang(c)) await GM.ensureTranslations(c, GM.campaignSources(c), [vl]);
  const tx = GM.pickText(c, vl, st.subject || c.subject || '', st.body || '');
  const vars = SAMPLE(); if (vl !== 'cs') vars.osloveni = vars.jmeno;
  const link = c.link || undefined, subject = GM.render(tx.subject, vars);
  const EM = require('../services/email');
  let html = EM.renderEmailHtml({ title: subject, body: GM.render(tx.body, vars), link, linkLabel: link ? (tx.link_label || 'Otevřít') : undefined, noLink: !link, brand: 'laundromats:' + vl, flyerUrl: c.image_url || undefined });
  html = html.replace(/<\/body>/i, '<div style="text-align:center;font-size:11px;color:#6b7d99;padding:10px 0 18px"><a href="#" style="color:#6b7d99;text-decoration:underline">' + ((EM.LAUNDRO_TXT[vl] || EM.LAUNDRO_TXT.en).unsub) + '</a></div></body>');
  res.json({ html, subject, lang: vl, translations: c.translations || {}, from: (c.from_name || 'Laundromats') + (GM.fromOf(c) ? ' <' + GM.fromOf(c) + '>' : '') });
}));
router.post('/test-draft', wrap(async (req, res) => {
  const c = draftOf(req.body || {}), to = String((req.body && req.body.to) || (req.user && req.user.person && req.user.person.email) || '').trim();
  if (!GM.fromOf(c)) return res.status(400).json({ error: 'Vyber odesílatele.' });
  const r = await GM.sendTest(c, to, (req.body || {}).view_lang); if (!r.ok) return res.status(502).json({ error: r.error });
  res.json({ ok: true, to, translations: c.translations || {} });
}));
// Obrázek do e-mailu: data URL (JPG/PNG/GIF/WebP, max 5 MB) → Cloudflare R2 → veřejná https adresa
router.post('/image', wrap(async (req, res) => {
  const m = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String((req.body || {}).data || ''));
  if (!m) return res.status(400).json({ error: 'Nahraj obrázek JPG, PNG, GIF nebo WebP.' });
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Obrázek je větší než 5 MB.' });
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' }[m[1]];
  const { putObject } = require('../services/storage/r2');
  const r = await putObject('game-mail/' + require('crypto').randomUUID() + ext, buf, m[1]);
  if (!r.url) return res.status(503).json({ error: 'Úložiště obrázků nemá veřejnou adresu (R2_PUBLIC_URL).' });
  res.json({ url: r.url });
}));
// AI návrh textu kampaně podle zadání
router.post('/ai-draft', wrap(async (req, res) => {
  const b = req.body || {}, brief = String(b.brief || '').trim().slice(0, 4000);
  if (!brief) return res.status(400).json({ error: 'Napiš zadání — o čem má e-mail být.' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Chybí ANTHROPIC_API_KEY.' });
  const lang = GM.LANGS.includes(String(b.lang)) ? String(b.lang) : 'cs', kind = KINDS.includes(String(b.kind)) ? String(b.kind) : 'oneoff';
  const nSteps = kind === 'sequence' ? Math.min(8, Math.max(1, parseInt(b.steps, 10) || 3)) : 0;
  const phs = (Array.isArray(b.placeholders) ? b.placeholders : []).map((x) => String(x).slice(0, 40)).slice(0, 40);
  const LN = { cs: 'češtině', en: 'angličtině', pl: 'polštině', sk: 'slovenštině', de: 'němčině', hu: 'maďarštině', ro: 'rumunštině', it: 'italštině', es: 'španělštině', fr: 'francouzštině' }[lang];
  const system = [
    'Píšeš marketingové e-maily pro značku Laundromats (síť samoobslužných prádelen — prádlomatů; provozovatel Best Series) a její online hru Laundromat Tycoon, kde hráči budují vlastní síť prádelen.',
    'Příjemci jsou kontakty z CRM (zájemci o prádlomat nebo franšízu, zákazníci, hráči hry). E-mail má být lidský, konkrétní, krátký (cca 80–160 slov), s jasnou výzvou k akci. Žádné přehnané sliby, žádná vymyšlená čísla — co nevíš, nepiš.',
    'Text je ČISTÝ TEXT (žádné HTML ani Markdown, žádné hvězdičky); odstavce odděl prázdným řádkem. Šablona e-mailu už má logo a hlavičku — nezačínej názvem značky.',
    'Můžeš použít proměnné ve tvaru {{nazev}}: ' + (phs.length ? phs.join(', ') : 'jmeno, prijmeni, firma') + ', osloveni. V češtině oslovuj „Dobrý den, {{osloveni}},“ ({{osloveni}} = křestní jméno v 5. pádě); u kontaktů bez jména se doplní prázdno, proto ho nepoužívej jinde ve větě.',
    'Piš v ' + LN + '. Předmět max 70 znaků, bez emoji na začátku, ať nepůsobí jako spam.',
    'Vrať POUZE JSON bez bloku ```: ' + (kind === 'sequence'
      ? '{"steps":[{"day":0,"subject":"…","body":"…"}, …]} — přesně ' + nSteps + ' kroků, den 0 = hned, další s rozestupem pár dní, každý krok navazuje na předchozí.'
      : '{"subject":"…","body":"…","link_label":"krátký popisek tlačítka (max 30 znaků) nebo prázdné"}'),
  ].join('\n');
  const cur = b.current && (b.current.subject || b.current.body) ? '\n\nSOUČASNÁ VERZE (uprav podle zadání, pokud se hodí):\nPředmět: ' + String(b.current.subject || '').slice(0, 300) + '\n' + String(b.current.body || '').slice(0, 6000) : '';
  const Anthropic = require('@anthropic-ai/sdk'); const { messagesCreate } = require('../services/anthropic-retry');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const r = await messagesCreate(client, { model: process.env.GM_AI_MODEL || 'claude-sonnet-4-6', max_tokens: 4000, system, messages: [{ role: 'user', content: 'ZADÁNÍ: ' + brief + cur }] });
  const t = (r.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('');
  let j = null; try { j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch (e) { j = null; }
  if (!j) return res.status(502).json({ error: 'AI nevrátila použitelný návrh, zkus to znovu.' });
  if (kind === 'sequence') return res.json({ steps: (Array.isArray(j.steps) ? j.steps : []).slice(0, 8).map((s, i) => ({ day: Math.max(0, parseInt(s.day, 10) || (i ? i * 3 : 0)), subject: String(s.subject || '').slice(0, 300), body: String(s.body || '').slice(0, 20000) })) });
  res.json({ subject: String(j.subject || '').slice(0, 300), body: String(j.body || '').slice(0, 20000), link_label: String(j.link_label || '').slice(0, 80) });
}));

router.post('/audience-count', wrap(async (req, res) => { res.json(await GM.audienceCount(cleanAudience((req.body || {}).audience))); }));

// Zkušební zpráva na zadanou adresu (nezapočítává se, nejde do statistik kampaně)
router.post('/campaigns/:id(\\d+)/test', wrap(async (req, res) => {
  const c = await prisma.gameMailCampaign.findUnique({ where: { id: parseInt(req.params.id, 10) } });
  if (!c) return res.status(404).json({ error: 'Kampaň nenalezena' });
  const to = (req.body && req.body.to) || (req.user && req.user.email) || '';
  const r = await GM.sendTest(c, to); if (!r.ok) return res.status(502).json({ error: r.error });
  res.json({ ok: true, to });
}));

function checkReady(c) {
  if (!GM.fromOf(c)) return 'Vyber odesílatele (adresa z domény Laundromats, ověřená v Amazon SES).';
  if (c.kind === 'sequence') { const st = Array.isArray(c.steps) ? c.steps : []; if (!st.length) return 'Sekvence nemá žádný krok.'; if (st.some((s) => !(s.subject || c.subject))) return 'Každý krok potřebuje předmět.'; return null; }
  if (!c.subject) return 'Chybí předmět.';
  if (!String(c.body || '').trim()) return 'Chybí text zprávy.';
  return null;
}

// Jednorázová: odeslat hned (mode: now) nebo naplánovat (mode: schedule, at)
router.post('/campaigns/:id(\\d+)/send', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10); const c = await prisma.gameMailCampaign.findUnique({ where: { id } });
  if (!c || c.kind !== 'oneoff') return res.status(404).json({ error: 'Kampaň nenalezena' });
  if (['sending', 'sent'].includes(c.status)) return res.status(409).json({ error: 'Kampaň už byla odeslána.' });
  const bad = checkReady(c); if (bad) return res.status(400).json({ error: bad });
  const aud = await GM.audienceCount(c.audience); if (!aud.sendable) return res.status(400).json({ error: 'Publikum je prázdné — není komu poslat.' });
  let at = new Date();
  if ((req.body || {}).mode === 'schedule') { at = new Date((req.body || {}).at); if (isNaN(at) || at.getTime() < Date.now() - 60000) return res.status(400).json({ error: 'Zadej čas v budoucnosti.' }); }
  const upd = await prisma.gameMailCampaign.update({ where: { id }, data: { status: 'scheduled', next_run_at: at, schedule: { at: at.toISOString() }, last_error: null } });
  setTimeout(() => GM.tick().catch(() => {}), 500); // „hned" = nejbližší průchod workeru
  res.json({ ok: true, campaign: upd, recipients: aud.sendable });
}));
// Vrátit naplánovanou kampaň do konceptu
router.post('/campaigns/:id(\\d+)/unschedule', wrap(async (req, res) => {
  const r = await prisma.gameMailCampaign.updateMany({ where: { id: parseInt(req.params.id, 10), kind: 'oneoff', status: 'scheduled' }, data: { status: 'draft', next_run_at: null } });
  res.json({ ok: !!r.count });
}));

// Pravidelná / sekvence: zapnout a vypnout
router.post('/campaigns/:id(\\d+)/activate', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10); const c = await prisma.gameMailCampaign.findUnique({ where: { id } });
  if (!c || c.kind === 'oneoff') return res.status(404).json({ error: 'Kampaň nenalezena' });
  const bad = checkReady(c); if (bad) return res.status(400).json({ error: bad });
  const data = { status: 'active', last_error: null };
  if (c.kind === 'recurring') data.next_run_at = GM.nextRun(c.schedule, new Date());
  else if (!c.started_at) data.started_at = new Date(); // sekvence: odpočet kroků od prvního zapnutí
  res.json({ ok: true, campaign: await prisma.gameMailCampaign.update({ where: { id }, data }) });
}));
router.post('/campaigns/:id(\\d+)/pause', wrap(async (req, res) => {
  const r = await prisma.gameMailCampaign.updateMany({ where: { id: parseInt(req.params.id, 10), kind: { in: ['recurring', 'sequence'] } }, data: { status: 'paused' } });
  res.json({ ok: !!r.count });
}));

// Statistiky kampaně: odeslání z evidence + doručení / otevření / kliky ze SES (EmailMessage.campaignId = gm-<id>)
router.get('/campaigns/:id(\\d+)/stats', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [sent, errors, last, rows, errs] = await Promise.all([
    prisma.gameMailSend.count({ where: { campaign_id: id, status: 'sent' } }),
    prisma.gameMailSend.count({ where: { campaign_id: id, status: 'error' } }),
    prisma.gameMailSend.findFirst({ where: { campaign_id: id }, orderBy: { id: 'desc' }, select: { sent_at: true } }),
    prisma.emailMessage.findMany({ where: { campaignId: 'gm-' + id }, select: { status: true, delivered: true, opened: true, clicked: true, bounced: true, unsubscribed: true }, take: 200000 }),
    prisma.gameMailSend.findMany({ where: { campaign_id: id, status: 'error' }, orderBy: { id: 'desc' }, take: 5, select: { email_lower: true, error: true } }),
  ]);
  const n = (f) => rows.filter(f).length; const base = rows.filter((r) => /^odesláno/.test(r.status || '')).length || sent;
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  const delivered = n((r) => r.delivered), opened = n((r) => r.opened), clicked = n((r) => r.clicked);
  res.json({ sent, errors, last_at: last && last.sent_at, delivered, opened, clicked, bounced: n((r) => r.bounced), unsubscribed: n((r) => r.unsubscribed), open_rate: pct(opened, delivered || base), click_rate: pct(clicked, delivered || base), tracking: !!process.env.SES_CONFIGURATION_SET, last_errors: errs });
}));

module.exports = router;
