// HolyOS — Laundromat Tycoon: e-mailing (seznam kontaktů + jednorázové / pravidelné kampaně + sekvence)
// Odesílá se výhradně přes Amazon SES z odesílatele nastaveného u kampaně (doména Laundromats musí být
// v HolyOS → Nastavení → odesílatelé SES a ověřená v SES). Odhlášení řeší standardní /u/<token> HolyOS.
const { prisma } = require('../../config/database');

const LANGS = ['cs', 'en', 'pl', 'sk', 'de', 'hu', 'ro', 'it', 'es', 'fr'];
const TZ = 'Europe/Prague';
const SEND_GAP_MS = 120; // ~8 zpráv/s (limit SES je typicky 14/s)
const TICK_MAX_SENDS = 300; // strop odeslaných zpráv jedné kampaně za jeden průchod workeru

const EMAIL_RE = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]{2,}$/;
function cleanEmail(s) { const e = String(s == null ? '' : s).trim().replace(/^mailto:/i, '').replace(/^['"<]+|['">]+$/g, '').trim(); return EMAIL_RE.test(e) ? e.slice(0, 200) : null; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Text z CRM: ořezat mezery, textové „null" = prázdné
function cleanText(v, n) { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return !s || /^(null|undefined|n\/a|-)$/i.test(s) ? null : s.slice(0, n || 200); }
// Buňka s e-maily („a@x.cz, b@x.cz") → první platná adresa + ostatní platné zvlášť
function parseEmails(v) {
  const all = String(v == null ? '' : v).split(/[\s,;]+/).map(cleanEmail).filter(Boolean);
  const uniq = []; all.forEach((e) => { if (!uniq.some((u) => u.toLowerCase() === e.toLowerCase())) uniq.push(e); });
  return { email: uniq[0] || null, others: uniq.slice(1) };
}
// Země (jak ji píše CRM) → jazyk šablony e-mailu; neznámá země = nic (použije se jazyk kampaně)
function langFromCountry(c) {
  const t = String(c || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!t) return null;
  if (/ceska|^cr$|czech|cesko/.test(t)) return 'cs';
  if (/slovensk|slovak/.test(t)) return 'sk';
  if (/polsk|poland/.test(t)) return 'pl';
  if (/nemeck|german|rakous|austria/.test(t)) return 'de';
  if (/madar|hungary/.test(t)) return 'hu';
  if (/rumun|romania/.test(t)) return 'ro';
  if (/ital/.test(t)) return 'it';
  if (/spanel|spain/.test(t)) return 'es';
  if (/francie|france|francouz/.test(t)) return 'fr';
  if (/portugal|irsk|ireland|chorvat|croatia|velka britanie|britanie|anglie|skotsk|england|scotland|nizozem|belgie|lucemb|slovinsk/.test(t)) return 'en';
  return null;
}

// Klíč proměnné ze jména sloupce: „Název firmy" → nazev_firmy (bez diakritiky)
function slug(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40); }

function contactVars(c) {
  const v = { jmeno: c.first_name || '', prijmeni: c.last_name || '', firma: c.company || '', email: c.email || '', telefon: c.phone || '' };
  v.first_name = v.jmeno; v.last_name = v.prijmeni; v.company = v.firma;
  v.stav = c.stage || ''; v.typ_kontaktu = c.kind || ''; v.zeme = c.country || '';
  // {{osloveni}} = křestní jméno v 5. pádě (Petře, Jano); u neznámých jmen zůstane 1. pád
  try { v.osloveni = v.jmeno ? require('../vocative').vocativeFirstName(v.jmeno) : ''; } catch (e) { v.osloveni = v.jmeno; }
  const ex = c.extra && typeof c.extra === 'object' ? c.extra : {};
  Object.keys(ex).forEach((k) => { const sk = slug(k); if (sk && v[sk] == null) v[sk] = String(ex[k] == null ? '' : ex[k]); });
  return v;
}
function render(tpl, vars) { return String(tpl || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k) => { const x = vars[slug(k)]; return x == null ? '' : String(x); }); }

// ── Příjemci kampaně ─────────────────────────────────────────────
function tagList(s) { return String(s || '').split(/[,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean); }

async function suppressedSet() {
  const set = new Set();
  const bl = await prisma.compounderBlocklist.findMany({ where: { email: { not: null } }, select: { email: true }, take: 200000 }).catch(() => []);
  bl.forEach((b) => { const e = String(b.email || '').trim().toLowerCase(); if (e) set.add(e); });
  const em = await prisma.emailMessage.findMany({ where: { OR: [{ unsubscribed: true }, { bounced: true }] }, select: { to: true }, distinct: ['to'], take: 200000 }).catch(() => []);
  em.forEach((m) => { const e = String(m.to || '').trim().toLowerCase(); if (e) set.add(e); });
  return set;
}

/** Vrátí příjemce podle nastavení publika: [{ email, lower, vars, lang, created_at, kind }] */
async function resolveAudience(aud) {
  aud = aud && typeof aud === 'object' ? aud : {};
  const out = []; const seen = new Set();
  if (aud.contacts !== false) {
    const where = { status: 'active' };
    const list = await prisma.gameMailContact.findMany({ where, orderBy: { id: 'asc' }, take: 100000 });
    const want = tagList(aud.tag);
    const lc = (a) => (Array.isArray(a) ? a : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
    const stages = lc(aud.stages), kinds = lc(aud.kinds), countries = lc(aud.countries);
    const has = (arr, v) => !arr.length || arr.includes(String(v || '').trim().toLowerCase() || '(prázdné)');
    list.forEach((c) => {
      if (want.length) { const have = tagList(c.tags); if (!want.some((t) => have.includes(t))) return; }
      if (!has(stages, c.stage) || !has(kinds, c.kind) || !has(countries, c.country)) return;
      if (seen.has(c.email_lower)) return; seen.add(c.email_lower);
      out.push({ email: c.email, lower: c.email_lower, vars: contactVars(c), lang: c.lang || '', created_at: c.created_at, kind: 'contact' });
    });
  }
  if (aud.players) {
    const where = { email: { not: null }, disabled: false };
    if (aud.player_lang) where.jazyk = String(aud.player_lang).slice(0, 5);
    const pl = await prisma.gamePlayer.findMany({ where, select: { email: true, first_name: true, last_name: true, nick: true, jazyk: true, created_at: true }, orderBy: { id: 'asc' }, take: 100000 }).catch(() => []);
    pl.forEach((p) => {
      const em = cleanEmail(p.email); if (!em) return; const lo = em.toLowerCase();
      if (seen.has(lo)) return; seen.add(lo);
      const vars = contactVars({ first_name: p.first_name || p.nick, last_name: p.last_name, email: em }); vars.nick = p.nick || '';
      out.push({ email: em, lower: lo, vars, lang: p.jazyk || '', created_at: p.created_at, kind: 'player' });
    });
  }
  return out;
}

async function audienceCount(aud) {
  const [list, sup] = await Promise.all([resolveAudience(aud), suppressedSet()]);
  const ok = list.filter((r) => !sup.has(r.lower));
  const langs = {}; ok.forEach((r) => { const l = LANGS.includes(String(r.lang || '').slice(0, 2).toLowerCase()) ? String(r.lang).slice(0, 2).toLowerCase() : '?'; langs[l] = (langs[l] || 0) + 1; });
  return { total: list.length, sendable: ok.length, suppressed: list.length - ok.length, contacts: ok.filter((r) => r.kind === 'contact').length, players: ok.filter((r) => r.kind === 'player').length, langs };
}

// ── Překlady do jazyka příjemce ────────────────────────────────────
// Jazyk příjemce = jazyk kontaktu (odvozený ze země) / hráče; neznámý = jazyk šablony kampaně.
// Překlad dělá Claude jednou pro každý text a jazyk, ukládá se do kampaně (translations) pod hash zdroje,
// takže změna textu vyvolá nový překlad. Když překlad selže, odejde text v jazyce kampaně.
const LANG_NAMES = { cs: 'čeština', en: 'angličtina', pl: 'polština', sk: 'slovenština', de: 'němčina', hu: 'maďarština', ro: 'rumunština', it: 'italština', es: 'španělština', fr: 'francouzština' };
const baseLang = (c) => (LANGS.includes(c.lang) ? c.lang : 'cs');
function langOf(c, rcpt) { const l = String((rcpt && rcpt.lang) || '').slice(0, 2).toLowerCase(); return LANGS.includes(l) ? l : baseLang(c); }
function srcKey(subject, body, linkLabel) { return require('crypto').createHash('sha1').update(String(subject || '') + '\u0001' + String(body || '') + '\u0001' + String(linkLabel || '')).digest('hex').slice(0, 16); }
function pickText(c, l, subject, body) {
  const out = { subject, body, link_label: c.link_label || '' };
  if (l === baseLang(c)) return out;
  const t = c.translations && c.translations[srcKey(subject, body, c.link_label)]; const x = t && t[l];
  return x ? { subject: x.subject || subject, body: x.body || body, link_label: x.link_label || out.link_label } : out;
}
async function translateSource(src, from, langs) {
  if (!process.env.ANTHROPIC_API_KEY || !langs.length) return null;
  const Anthropic = require('@anthropic-ai/sdk'); const { messagesCreate } = require('../anthropic-retry');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const system = 'Překládáš marketingový e-mail značky Laundromats (samoobslužné prádelny) a její hry Laundromat Tycoon. Přelož přirozeně a idiomaticky, jako by to psal rodilý mluvčí (ne doslovně), zachovej tón, odstavce (prázdné řádky) a délku. Proměnné ve tvaru {{nazev}} NEPŘEKLÁDEJ a nech je přesně, jak jsou (i se závorkami). Názvy Laundromats a Laundromat Tycoon nepřekládej. Text je čistý text bez HTML.\n'
    + 'Vrať POUZE JSON bez bloku ```: {"<kód jazyka>":{"subject":"…","body":"…","link_label":"…"}, …} pro jazyky: ' + langs.map((l) => l + ' (' + LANG_NAMES[l] + ')').join(', ') + '. Když je link_label prázdný, nech ho prázdný.';
  const user = 'ZDROJOVÝ JAZYK: ' + LANG_NAMES[from] + '\nPŘEDMĚT: ' + src.subject + '\nPOPISEK TLAČÍTKA: ' + (src.link_label || '') + '\nTEXT:\n' + src.body;
  const r = await messagesCreate(client, { model: process.env.GM_AI_MODEL || 'claude-sonnet-4-6', max_tokens: Math.min(16000, 1500 + langs.length * 1800), system, messages: [{ role: 'user', content: user }] });
  const t = (r.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('');
  let j = null; try { j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch (e) { j = null; }
  if (!j || typeof j !== 'object') return null;
  const out = {}; langs.forEach((l) => { const x = j[l]; if (x && (x.subject || x.body)) out[l] = { subject: String(x.subject || '').slice(0, 300), body: String(x.body || '').slice(0, 20000), link_label: String(x.link_label || '').slice(0, 80) }; });
  return out;
}
/** Doplní chybějící překlady pro zdroje [{subject, body}] a jazyky; uloží do kampaně (má-li id). Vrací c.translations. */
async function ensureTranslations(c, sources, langs) {
  const base = baseLang(c); const need = Array.from(new Set(langs)).filter((l) => LANGS.includes(l) && l !== base);
  const tr = c.translations && typeof c.translations === 'object' ? Object.assign({}, c.translations) : {};
  if (!need.length) { c.translations = tr; return tr; }
  let changed = false;
  for (const s of sources) {
    if (!s || !(s.subject || s.body)) continue;
    const k = srcKey(s.subject, s.body, c.link_label); const have = tr[k] || {};
    const miss = need.filter((l) => !have[l]); if (!miss.length) continue;
    for (let i = 0; i < miss.length; i += 4) { // po 4 jazycích, ať odpověď není useknutá
      try { const got = await translateSource({ subject: s.subject || '', body: s.body || '', link_label: c.link_label || '' }, base, miss.slice(i, i + 4)); if (got && Object.keys(got).length) { tr[k] = Object.assign({}, tr[k] || {}, got); changed = true; } }
      catch (e) { console.warn('[game-mailing] překlad', c.id, e.message); }
    }
  }
  // staré překlady (k textům, které už v kampani nejsou) vyhodit
  const live = new Set(sources.filter(Boolean).map((s) => srcKey(s.subject, s.body, c.link_label)));
  Object.keys(tr).forEach((k) => { if (!live.has(k)) { delete tr[k]; changed = true; } });
  c.translations = tr;
  if (changed && c.id) await prisma.gameMailCampaign.update({ where: { id: c.id }, data: { translations: tr } }).catch((e) => console.warn('[game-mailing] uložení překladů', e.message));
  return tr;
}
function campaignSources(c) { return c.kind === 'sequence' ? (Array.isArray(c.steps) ? c.steps : []).map((s) => ({ subject: s.subject || c.subject, body: s.body || '' })) : [{ subject: c.subject, body: c.body }]; }

// ── Odeslání jedné zprávy ─────────────────────────────────────────
function fromOf(c) { return String(c.from_address || process.env.GM_MAIL_FROM || '').trim(); }

async function sendOne(c, rcpt, subject, body, campaignId, prefix) {
  const from = fromOf(c);
  if (!from) return { ok: false, error: 'Chybí odesílatel (vyber ho u kampaně)' };
  const l = langOf(c, rcpt);
  // text v jazyce příjemce (překlad z kampaně), {{osloveni}} v 5. pádě jen v češtině
  const tx = pickText(c, l, subject, body); subject = (prefix || '') + tx.subject; body = tx.body;
  const vars = l === 'cs' ? rcpt.vars : Object.assign({}, rcpt.vars, { osloveni: rcpt.vars && rcpt.vars.jmeno ? rcpt.vars.jmeno : '' });
  try {
    const link = c.link && /^https:\/\//.test(c.link) ? c.link : undefined;
    const r = await require('../email').sendMail({
      to: rcpt.email, from, fromName: String(c.from_name || 'Laundromats').slice(0, 80), brand: 'laundromats:' + l,
      replyTo: c.reply_to || undefined, subject: render(subject, vars).slice(0, 300), body: render(body, vars).slice(0, 20000),
      link, linkLabel: link && tx.link_label ? String(tx.link_label).slice(0, 80) : undefined, noLink: !link,
      flyerUrl: c.image_url && /^https:\/\//.test(c.image_url) ? c.image_url : undefined,
      campaignId: campaignId || ('gm-' + c.id), onlySes: true,
    });
    if (!r || !r.sent) return { ok: false, error: String((r && (r.error || r.skipped)) || 'Odeslání selhalo').slice(0, 290) };
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 290) }; }
}

async function sendTest(c, to, lang) {
  const email = cleanEmail(to); if (!email) return { ok: false, error: 'Neplatná adresa' };
  const sample = { email, lower: email.toLowerCase(), lang: LANGS.includes(String(lang || '')) ? String(lang) : (c.lang || ''), vars: contactVars({ first_name: 'Jana', last_name: 'Nováková', company: 'Ukázka s.r.o.', email, phone: '+420 600 000 000' }) };
  const steps = Array.isArray(c.steps) ? c.steps : [];
  const first = c.kind === 'sequence' && steps[0] ? steps[0] : { subject: c.subject, body: c.body };
  if (sample.lang && sample.lang !== baseLang(c)) await ensureTranslations(c, campaignSources(c), [sample.lang]);
  return sendOne(c, sample, first.subject || c.subject || '', first.body != null ? first.body : c.body, 'gm-test', '[TEST] ');
}

// ── Rozvrh pravidelných kampaní (čas v Europe/Prague) ─────────────
function pragueParts(d) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(d);
  const g = (t) => (f.find((x) => x.type === t) || {}).value;
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[g('weekday')];
  return { y: +g('year'), m: +g('month'), d: +g('day'), h: (+g('hour')) % 24, dow: wd };
}
function pragueToUtc(y, m, d, h) {
  const guess = new Date(Date.UTC(y, m - 1, d, h, 0, 0));
  const p = pragueParts(guess); const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, 0, 0);
  return new Date(guess.getTime() - (asUtc - guess.getTime()));
}
function dateKey(d) { const p = pragueParts(d); return p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0'); }
/** Nejbližší spuštění po čase `from` podle rozvrhu { freq, dow, dom, hour } */
function nextRun(sch, from) {
  sch = sch || {}; const freq = ['daily', 'weekly', 'monthly'].includes(sch.freq) ? sch.freq : 'weekly';
  const hour = Math.min(23, Math.max(0, parseInt(sch.hour, 10) || 9)); const dow = Math.min(7, Math.max(1, parseInt(sch.dow, 10) || 1)); const dom = Math.min(28, Math.max(1, parseInt(sch.dom, 10) || 1));
  for (let i = 0; i < 400; i++) {
    const day = new Date(from.getTime() + i * 86400000); const p = pragueParts(day);
    if (freq === 'weekly' && p.dow !== dow) continue;
    if (freq === 'monthly' && p.d !== dom) continue;
    const t = pragueToUtc(p.y, p.m, p.d, hour);
    if (t.getTime() > from.getTime()) return t;
  }
  return null;
}

// ── Spuštění kampaní ──────────────────────────────────────────────
async function existingKeys(campaignId, runKeys) {
  const rows = await prisma.gameMailSend.findMany({ where: { campaign_id: campaignId, run_key: { in: runKeys } }, select: { email_lower: true, run_key: true }, take: 500000 });
  return new Set(rows.map((r) => r.email_lower + '|' + r.run_key));
}
async function record(campaignId, lower, runKey, r) {
  try { await prisma.gameMailSend.create({ data: { campaign_id: campaignId, email_lower: lower, run_key: runKey, status: r.ok ? 'sent' : 'error', error: r.ok ? null : r.error } }); } catch (e) { /* duplicita = už evidováno */ }
}

/** Rozešle jednu dávku: items = [{ rcpt, runKey, subject, body }]. Vrací { sent, failed, firstError } */
async function dispatch(c, items, budget) {
  let sent = 0, failed = 0, firstError = '';
  // před rozesláním doplnit překlady pro jazyky příjemců této dávky
  const batch = budget != null ? items.slice(0, budget) : items;
  if (batch.length) await ensureTranslations(c, campaignSources(c), batch.map((it) => langOf(c, it.rcpt)));
  for (const it of items) {
    if (budget != null && sent + failed >= budget) break;
    const r = await sendOne(c, it.rcpt, it.subject, it.body);
    await record(c.id, it.rcpt.lower, it.runKey, r);
    if (r.ok) sent++; else { failed++; if (!firstError) firstError = r.error; }
    // Odesílatel/SES nastavený špatně → nemá smysl zkoušet všechny příjemce
    if (!r.ok && /není mezi odesílateli|Amazon SES není|Chybí odesílatel|not verified|není ověřený/i.test(r.error) && failed >= 3 && sent === 0) break;
    await sleep(SEND_GAP_MS);
  }
  return { sent, failed, firstError };
}

async function runOneoff(c) {
  const [aud, sup] = await Promise.all([resolveAudience(c.audience), suppressedSet()]);
  const done = await existingKeys(c.id, ['once']);
  const items = aud.filter((r) => !sup.has(r.lower) && !done.has(r.lower + '|once')).map((r) => ({ rcpt: r, runKey: 'once', subject: c.subject, body: c.body }));
  const res = await dispatch(c, items, TICK_MAX_SENDS);
  const left = items.length - res.sent - res.failed;
  const data = { sent_count: { increment: res.sent }, last_run_at: new Date(), last_error: res.firstError || null };
  if (left > 0 && !(res.failed >= 3 && res.sent === 0)) { data.status = 'sending'; } // další dávka v dalším průchodu
  else data.status = res.sent === 0 && res.failed > 0 && !done.size ? 'draft' : 'sent';
  await prisma.gameMailCampaign.update({ where: { id: c.id }, data });
}

async function runRecurring(c) {
  const key = dateKey(new Date());
  const [aud, sup] = await Promise.all([resolveAudience(c.audience), suppressedSet()]);
  const done = await existingKeys(c.id, [key]);
  const items = aud.filter((r) => !sup.has(r.lower) && !done.has(r.lower + '|' + key)).map((r) => ({ rcpt: r, runKey: key, subject: c.subject, body: c.body }));
  const res = await dispatch(c, items, TICK_MAX_SENDS);
  const left = items.length - res.sent - res.failed;
  const data = { sent_count: { increment: res.sent }, last_run_at: new Date(), last_error: res.firstError || null };
  // zbytek se dopošle v dalším průchodu (stejný den, stejný klíč); jinak se naplánuje další termín
  if (left > 0 && !(res.failed >= 3 && res.sent === 0)) data.next_run_at = new Date(Date.now() + 60000);
  else data.next_run_at = nextRun(c.schedule, new Date());
  await prisma.gameMailCampaign.update({ where: { id: c.id }, data });
}

async function runSequence(c) {
  const steps = (Array.isArray(c.steps) ? c.steps : []).map((s, i) => ({ i, day: Math.max(0, Number(s.day) || 0), subject: s.subject || c.subject, body: s.body || '' })).filter((s) => s.body || s.subject);
  if (!steps.length) return;
  const started = c.started_at ? new Date(c.started_at).getTime() : Date.now();
  const [aud, sup] = await Promise.all([resolveAudience(c.audience), suppressedSet()]);
  const done = await existingKeys(c.id, steps.map((s) => 's' + s.i));
  const now = Date.now(); const items = [];
  aud.forEach((r) => {
    if (sup.has(r.lower)) return;
    const enrolled = Math.max(started, r.created_at ? new Date(r.created_at).getTime() : started);
    steps.forEach((s) => { if (enrolled + s.day * 86400000 <= now && !done.has(r.lower + '|s' + s.i)) items.push({ rcpt: r, runKey: 's' + s.i, subject: s.subject, body: s.body, order: s.i }); });
  });
  if (!items.length) return;
  items.sort((a, b) => a.order - b.order);
  const res = await dispatch(c, items, TICK_MAX_SENDS);
  await prisma.gameMailCampaign.update({ where: { id: c.id }, data: { sent_count: { increment: res.sent }, last_run_at: new Date(), last_error: res.firstError || null } });
}

let busy = false;
async function tick() {
  if (busy) return; busy = true;
  try {
    const now = new Date();
    const stale = new Date(now.getTime() - 3 * 60000);
    // jednorázové: naplánované a čas nastal, nebo rozeslané jen částečně (stav „sending" starší než 3 min = po restartu)
    const one = await prisma.gameMailCampaign.findMany({ where: { kind: 'oneoff', OR: [{ status: 'scheduled', next_run_at: { lte: now } }, { status: 'sending', updated_at: { lt: stale } }] } });
    for (const c of one) {
      const claim = await prisma.gameMailCampaign.updateMany({ where: { id: c.id, status: c.status }, data: { status: 'sending', updated_at: new Date() } });
      if (!claim.count) continue;
      try { await runOneoff(c); } catch (e) { console.error('[game-mailing] oneoff', c.id, e.message); await prisma.gameMailCampaign.update({ where: { id: c.id }, data: { status: 'draft', last_error: String(e.message).slice(0, 500) } }).catch(() => {}); }
    }
    const rec = await prisma.gameMailCampaign.findMany({ where: { kind: 'recurring', status: 'active', next_run_at: { lte: now } } });
    for (const c of rec) {
      try { await runRecurring(c); } catch (e) { console.error('[game-mailing] recurring', c.id, e.message); await prisma.gameMailCampaign.update({ where: { id: c.id }, data: { last_error: String(e.message).slice(0, 500), next_run_at: new Date(Date.now() + 15 * 60000) } }).catch(() => {}); }
    }
    const seq = await prisma.gameMailCampaign.findMany({ where: { kind: 'sequence', status: 'active' } });
    for (const c of seq) { try { await runSequence(c); } catch (e) { console.error('[game-mailing] sequence', c.id, e.message); await prisma.gameMailCampaign.update({ where: { id: c.id }, data: { last_error: String(e.message).slice(0, 500) } }).catch(() => {}); } }
  } catch (e) { console.error('[game-mailing] tick', e.message); }
  finally { busy = false; }
}

let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(tick, 60000);
  setTimeout(tick, 20000);
  console.log('[game-mailing] worker spuštěn (každou minutu)');
}

module.exports = { ensureTranslations, campaignSources, pickText, baseLang, LANG_NAMES, start, tick, LANGS, cleanEmail, cleanText, parseEmails, langFromCountry, slug, render, contactVars, resolveAudience, audienceCount, suppressedSet, sendTest, nextRun, fromOf, dateKey };
