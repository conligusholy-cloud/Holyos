// HolyOS — AI Marketingový ředitel nad Centrem reklamy
// =============================================================================
// Ředitel se NEKONFIGURUJE ručně. Při každém běhu si sám zjistí, co v Centru reklamy existuje
// (funely a jejich uzly, záchytné stránky, texty e-mailů/SMS, kanály, verze stránek, čísla),
// porovná to s předchozím stavem a o novinky/úpravy se postará:
//   • změnu poznají všechny nové uzly / stránky / texty bez zásahu do kódu ředitele,
//   • po ustálení změny (30 min bez další úpravy) automaticky udělá „revizi změn",
//   • jednou týdně sám udělá celkový audit,
//   • pamatuje si předchozí závěry (paměť), aby na sebe doporučení navazovala.
// Nic sám neodesílá ani nemění – jen navrhuje kroky ke schválení.
//
// CO SE ZACHYTÍ SAMO (bez úpravy tohoto souboru):
//   • funely a jejich kroky, záchytné stránky (PAGES) včetně cílů a verzí, texty e-mailů/SMS,
//   • KAŽDÉ nastavení uložené přes setSetting s klíčem začínajícím na ads_center. / compounder.aispec / bs2. … (viz SETTING_PREFIXES),
//     tj. i ekonomika, cíle stránek, kanály, synchronizace leadů a cokoli, co v Centru přibude – změna se pozná otiskem.
// CO SE PŘIDÁ JEDNÍM ŘÁDKEM: nový živý zdroj čísel → DIRECTOR.register('nazev', async (days) => data) (viz routes/ads-center.routes.js).
// Nový prefix klíčů nastavení → doplň do SETTING_PREFIXES.

const crypto = require('crypto');
const { prisma } = require('../../config/database');

const KEY_STATE = 'ads_director.state';       // { prev: kompaktní inventář, pending: {since, changes[]}, last_auto_at }
const KEY_REPORTS = 'ads_director.reports';   // posledních 12 zpráv
const KEY_MEMORY = 'ads_director.memory';     // poznámky ředitele a rozhodnutí (poslední ~30)
const DEBOUNCE_MS = 30 * 60 * 1000;           // změna se musí „ustálit"
const MIN_AUTO_GAP_MS = 6 * 3600 * 1000;      // automaticky nejvýš jednou za 6 h
const WEEKLY_MS = 7 * 24 * 3600 * 1000;

let deps = null; // { loadFunnels, funnelReport, PAGES, loadGoals }
function init(d) { deps = d; }
// Registr živých zdrojů dat: register('nazev', async () => data). Ředitel je při každém běhu načte a předá AI (nesledují se jako změna – jde o čísla).
// Nový zdroj čísel v Centru reklamy = jedno volání register(); nastavení uložená přes setSetting pod níže uvedenými prefixy se zachytí SAMA.
const sources = {};
function register(name, fn) { sources[String(name)] = fn; }
// Nastavení, která ředitel sleduje automaticky (AppSetting podle prefixu klíče) – cokoli nového pod těmito prefixy uvidí bez úpravy kódu
const SETTING_PREFIXES = ['ads_center.', 'compounder.aispec', 'compounder.ads', 'compounder.mail', 'compounder.outreach', 'bs2.'];
const SETTING_SKIP = /(run_jobs|cursor|last_run|last_sync|token|secret|pass|credential|oauth|ads_director\.|ads_center\.funnels$|backfill)/i; // tajné / provozní / už řešené jinde
async function autoSettings() {
  const out = {};
  try {
    const rows = await prisma.appSetting.findMany({ where: { OR: SETTING_PREFIXES.map((p) => ({ key: { startsWith: p } })) }, select: { key: true, value: true, description: true } });
    rows.forEach((r) => { if (SETTING_SKIP.test(r.key)) return; out[r.key] = { desc: r.description || null, value: String(r.value == null ? '' : r.value).slice(0, 900) }; });
  } catch (e) { /* bez nastavení */ }
  return out;
}
const S = () => require('../settings');
const h = (o) => crypto.createHash('sha1').update(JSON.stringify(o == null ? null : o)).digest('hex').slice(0, 12);
async function getJ(key, def) { try { const v = await S().getSetting(key, { type: 'json', defaultValue: def }); return v == null ? def : v; } catch (e) { return def; } }
async function setJ(key, v, desc) { await S().setSetting(key, v, { type: 'json', description: desc, scope: 'marketing' }); }

// ── 1) Inventář: co v Centru reklamy právě je (zjišťuje se dynamicky, nic není zadrátované) ──
async function inventory() {
  const funnels = (await deps.loadFunnels()).map((f) => ({
    id: f.id, name: f.name,
    nodes: (f.nodes || []).map((nd) => ({ id: nd.id, kind: nd.kind, label: nd.label || null, page: nd.page || null, variant: nd.variant || null, activated_at: nd.activated_at || null, cond: nd.cond || undefined, groups: nd.groups ? nd.groups.length : undefined })),
    edges: (f.edges || []).map((e) => e.from + '>' + e.to + (e.port ? '#' + e.port : '')),
  }));
  const PW = require('./page-watch'); const pages = []; let goalsAll = {}; try { goalsAll = deps.loadGoals ? await deps.loadGoals() : {}; } catch (e) { goalsAll = {}; }
  for (const p of (deps.PAGES || [])) { let v = []; try { v = await PW.versions(p.key); } catch (e) { v = []; } const last = v[v.length - 1] || null; pages.push({ key: p.key, name: p.name, url: p.url, desc: p.desc || null, goals: goalsAll[p.key] ? { summary: goalsAll[p.key].summary, source: goalsAll[p.key].source, goals: (goalsAll[p.key].goals || []).map((g) => ({ type: g.type, label: g.label, primary: g.primary })) } : null, version_at: last ? last.at : null, version_note: last ? (last.note || null) : null, recent_diffs: v.slice(-3).map((x) => ({ at: x.at, diff: x.diff, note: x.note })) }); }
  const outreach = await getJ('compounder.aispec_autosend', {});
  const messages = { email_specialist: { subject: outreach.specialistEmailSubject || null, body: outreach.specialistEmailBody || null, link_label: outreach.specialistEmailLinkLabel || null, from: outreach.specialistEmailFrom || null, enabled: !!outreach.emailEnabled }, email_schuzka: { subject: outreach.schuzkaEmailSubject || null, body: outreach.schuzkaEmailBody || null, enabled: !!outreach.schuzkaEmailEnabled }, sms: { text: outreach.text || null, enabled: !!outreach.enabled } };
  const settings = await autoSettings();
  return { funnels, pages, messages, settings };
}
// Kompaktní otisk pro porovnání (per uzel / stránka / zpráva)
function fingerprint(inv) {
  const fp = { funnels: {}, nodes: {}, pages: {}, messages: {}, settings: {} };
  Object.keys(inv.settings || {}).forEach((k) => { fp.settings[k] = { desc: inv.settings[k].desc || k, hash: h(inv.settings[k].value) }; });
  inv.funnels.forEach((f) => { fp.funnels[f.id] = { name: f.name, edges: h(f.edges) }; f.nodes.forEach((nd) => { fp.nodes[f.id + '/' + nd.id] = { funnel: f.name, kind: nd.kind, label: nd.label || nd.page || nd.kind, hash: h(nd) }; }); });
  inv.pages.forEach((p) => { fp.pages[p.key] = { name: p.name, hash: h([p.version_at, p.url, p.goals]) }; });
  Object.keys(inv.messages).forEach((k) => { fp.messages[k] = h(inv.messages[k]); });
  return fp;
}
function diff(prev, cur) {
  const out = []; if (!prev) return out; // první běh = nic „nového", jen výchozí stav
  Object.keys(cur.funnels).forEach((id) => { if (!prev.funnels[id]) out.push('Nový funel „' + cur.funnels[id].name + '"'); else if (prev.funnels[id].edges !== cur.funnels[id].edges) out.push('Změněno propojení kroků ve funelu „' + cur.funnels[id].name + '"'); });
  Object.keys(prev.funnels).forEach((id) => { if (!cur.funnels[id]) out.push('Smazán funel „' + prev.funnels[id].name + '"'); });
  Object.keys(cur.nodes).forEach((k) => { const n = cur.nodes[k], o = prev.nodes[k]; if (!o) out.push('Nový krok „' + n.label + '" (' + n.kind + ') ve funelu „' + n.funnel + '"'); else if (o.hash !== n.hash) out.push('Upraven krok „' + n.label + '" (' + n.kind + ') ve funelu „' + n.funnel + '"'); });
  Object.keys(prev.nodes).forEach((k) => { if (!cur.nodes[k]) out.push('Odstraněn krok „' + prev.nodes[k].label + '" z funelu „' + prev.nodes[k].funnel + '"'); });
  Object.keys(cur.pages).forEach((k) => { const n = cur.pages[k], o = prev.pages[k]; if (!o) out.push('Nová záchytná stránka „' + n.name + '"'); else if (o.hash !== n.hash) out.push('Upravena záchytná stránka „' + n.name + '"'); });
  const ps = prev.settings || {}; // starší otisk bez nastavení → nic „nového" nehlásit
  if (prev.settings) {
    Object.keys(cur.settings || {}).forEach((k) => { const n = cur.settings[k], o = ps[k]; if (!o) out.push('Nové nastavení: ' + n.desc); else if (o.hash !== n.hash) out.push('Změněno nastavení: ' + n.desc); });
    Object.keys(ps).forEach((k) => { if (!(cur.settings || {})[k]) out.push('Odstraněno nastavení: ' + ps[k].desc); });
  }
  Object.keys(cur.messages).forEach((k) => { if (prev.messages[k] != null && prev.messages[k] !== cur.messages[k]) out.push('Změněn text / nastavení zprávy: ' + k); else if (prev.messages[k] == null) out.push('Nová zpráva: ' + k); });
  return out;
}

// ── 2) Čísla: pro každý funel report za období (kanály, stránky, objednávky – co funel obsahuje) ──
async function metrics(days) {
  const out = [];
  for (const f of await deps.loadFunnels()) {
    try { const r = await deps.funnelReport({}, days, 0, f); out.push({ funnel: f.name, kpi: r.kpi, sms: r.sms, email: r.email, clickers: r.clickers, landing: r.landing, orders: r.orders, daily: (r.daily || []).slice(-14), forms: r.forms }); }
    catch (e) { out.push({ funnel: f.name, error: e.message }); }
  }
  let ses = null; try { ses = await require('../ses/email-log').stats(days >= 90 ? '90d' : days >= 30 ? '30d' : days >= 7 ? '7d' : 'today'); delete ses.byDay; } catch (e) { ses = null; }
  const extra = {}; for (const name of Object.keys(sources)) { try { extra[name] = await sources[name](days); } catch (e) { extra[name] = { error: e.message }; } }
  return { funnels: out, ses_email: ses, extra };
}

// ── 3) Ředitel ──
const SYSTEM = 'Jsi marketingový ředitel (CMO) a zároveň špičkový performance marketér, CRO specialista a direct-response copywriter firmy Best Series (prádlomaty – samoobslužné prádelny, prodej strojů, aplikace Prověření lokality a Vyhledávač míst; web compounder.world, bestseries2.cz). Řídíš CELÉ Centrum reklamy, ne jen funel: záchytné stránky (jejich cíle, verze, texty, návštěvnost, objednávky), funely, oslovení (e-mail, SMS), reklamní kampaně, ziskovost a ekonomiku, nastavení kanálů a vše ostatní, co je v inventáři a nastaveních. Tvoje práce: aby online marketing tvořil JEDEN koordinovaný systém (reklama → lead → e-mail / SMS → záchytná stránka → platba → další péče), každý krok navazoval na předchozí slibem i tónem a celek vedl k prodeji. Pravidla: (1) opírej se jen o dodaná data, každé tvrzení doplň číslem; chybí-li data, řekni to a navrhni, co měřit; (2) u malých vzorků mluv o „signálu", ne o jistotě; (3) hlídej soulad slibu v e-mailu / SMS / reklamě s tím, co člověk vidí na stránce; (4) hledej největší únik v celém řetězci, ne jen v jednom kroku; (5) navrhuj konkrétní kroky s dopadem, náročností a metrikou – nic nepředstírej, že jsi sám provedl; (6) vše, co je v inventáři nové nebo změněné, výslovně zhodnoť – nové věci zapoj do celku; (7) navazuj na předchozí závěry a poznámky z paměti, neopakuj je, hodnoť jejich dopad. Piš česky, stručně a prakticky.';

async function run(opts) {
  if (!deps) throw new Error('Ředitel není inicializovaný');
  const o = opts || {}; const mode = o.mode === 'changes' ? 'changes' : 'audit'; const days = Math.min(90, Math.max(1, parseInt(o.days, 10) || 30));
  const apiKey = process.env.ANTHROPIC_API_KEY; if (!apiKey) throw new Error('ANTHROPIC_API_KEY není nastavený');
  const inv = await inventory(); const fp = fingerprint(inv);
  const state = await getJ(KEY_STATE, {}); const changes = (o.changes && o.changes.length) ? o.changes : [...new Set([...(state.pending ? state.pending.changes : []), ...diff(state.prev, fp)])];
  const m = await metrics(days); const reports = await getJ(KEY_REPORTS, []); const memory = await getJ(KEY_MEMORY, []);
  const prevSummary = reports.slice(0, 3).map((r) => ({ at: r.at, mode: r.mode, summary: r.summary, actions: (r.actions || []).map((a) => a.title) }));
  const Anthropic = require('@anthropic-ai/sdk'); const client = new Anthropic({ apiKey });
  const ask = mode === 'changes'
    ? 'Udělej REVIZI ZMĚN. Zhodnoť každou novou / upravenou věc ze sekce ZMĚNY: zda dává smysl, zda navazuje na zbytek řetězce (slib – kanál – stránka – platba), co v ní chybí a co zapojit. Na konec 3 nejdůležitější další kroky.'
    : 'Udělej CELKOVÝ TÝDENNÍ AUDIT: (1) Verdikt na 3–4 věty a „kde teď unikají peníze" jedním číslem; (2) průchod řetězcem krok po kroku s čísly a propady; (3) soulad sdělení napříč kanály a stránkou; (4) zhodnocení všeho nového ze sekce ZMĚNY; (5) TOP 5 kroků seřazených podle dopad/náročnost; (6) A/B testy; (7) co dál měřit.';
  const prompt = ask + '\n\nOBDOBÍ DAT: posledních ' + days + ' dní.\n\nZMĚNY od posledního běhu (nové / upravené věci):\n' + (changes.length ? changes.map((c) => '- ' + c).join('\n') : '(žádné)') + '\n\nINVENTÁŘ (co v Centru reklamy právě existuje – funely, uzly, stránky, texty zpráv):\n' + JSON.stringify(inv).slice(0, 24000) + '\n\nČÍSLA (funely, SES a živé zdroje z celého Centra reklamy – stránky, ziskovost…):\n' + JSON.stringify(m).slice(0, 22000) + '\n\nPAMĚŤ (předchozí závěry a poznámky):\n' + JSON.stringify({ reports: prevSummary, notes: memory.slice(-15) }).slice(0, 6000) + '\n\nVýstup: Markdown s nadpisy ##. Úplně na konci přidej blok ```json s polem max. 6 navržených kroků: [{"title":"…","why":"…","area":"reklama|e-mail|sms|stránka|funel|měření","impact":"vysoký|střední|nízký","effort":"nízká|střední|vysoká"}] a pod něj jednu řádku „SHRNUTÍ: …" (max 2 věty pro paměť).';
  const r = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 6000, system: SYSTEM, messages: [{ role: 'user', content: prompt }] });
  let text = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  let actions = []; const jm = /```json\s*([\s\S]*?)```/.exec(text); if (jm) { try { actions = JSON.parse(jm[1]); } catch (e) { actions = []; } }
  const sm = /SHRNUTÍ:\s*(.+)$/m.exec(text); const summary = sm ? sm[1].trim() : '';
  text = text.replace(/```json[\s\S]*?```/, '').replace(/SHRNUTÍ:.*$/m, '').trim();
  const rep = { id: Date.now().toString(36), at: new Date().toISOString(), mode, days, changes, text, actions: Array.isArray(actions) ? actions.slice(0, 6) : [], summary };
  await setJ(KEY_REPORTS, [rep, ...reports].slice(0, 12), 'Marketingový ředitel – zprávy');
  if (summary) await setJ(KEY_MEMORY, [...memory, { at: rep.at, note: summary }].slice(-30), 'Marketingový ředitel – paměť');
  await setJ(KEY_STATE, Object.assign({}, state, { prev: fp, pending: null, last_run_at: rep.at, last_auto_at: o.auto ? rep.at : state.last_auto_at, last_audit_at: mode === 'audit' ? rep.at : state.last_audit_at }), 'Marketingový ředitel – stav');
  return rep;
}

async function reports() { return getJ(KEY_REPORTS, []); }
// Stav pro UI: kolik nových / upravených věcí ředitel ještě nezhodnotil
async function status() {
  const state = await getJ(KEY_STATE, {}); let pending = []; try { const inv = await inventory(); pending = [...new Set([...(state.pending ? state.pending.changes : []), ...diff(state.prev, fingerprint(inv))])]; } catch (e) { pending = []; }
  return { pending_changes: pending, last_run_at: state.last_run_at || null, last_audit_at: state.last_audit_at || null, first_run: !state.prev };
}

// ── 4) Hlídač změn: každých 20 min zjistí novinky; po ustálení spustí revizi, jednou týdně audit ──
let _busy = false;
async function tick() {
  if (_busy || !deps || !process.env.ANTHROPIC_API_KEY) return; _busy = true;
  try {
    const state = await getJ(KEY_STATE, {}); const inv = await inventory(); const fp = fingerprint(inv);
    if (!state.prev) { await setJ(KEY_STATE, Object.assign({}, state, { prev: fp }), 'Marketingový ředitel – stav'); return; } // výchozí stav, bez zbytečného běhu
    const fresh = diff(state.prev, fp); const nowMs = Date.now();
    let pending = state.pending || null;
    if (fresh.length) { const merged = [...new Set([...(pending ? pending.changes : []), ...fresh])]; pending = { since: nowMs, changes: merged }; await setJ(KEY_STATE, Object.assign({}, state, { prev: fp, pending }), 'Marketingový ředitel – stav'); return; } // změna běží dál → čekej na ustálení
    const lastAuto = state.last_auto_at ? Date.parse(state.last_auto_at) : 0;
    if (pending && pending.changes.length && nowMs - pending.since >= DEBOUNCE_MS && nowMs - lastAuto >= MIN_AUTO_GAP_MS) { console.log('[ads-director] revize změn:', pending.changes.length); await run({ mode: 'changes', changes: pending.changes, auto: true, days: 30 }); return; }
    const lastAudit = state.last_audit_at ? Date.parse(state.last_audit_at) : 0;
    if (nowMs - lastAudit >= WEEKLY_MS && nowMs - lastAuto >= MIN_AUTO_GAP_MS) { console.log('[ads-director] týdenní audit'); await run({ mode: 'audit', auto: true, days: 30 }); }
  } catch (e) { console.warn('[ads-director] tick:', e.message); }
  finally { _busy = false; }
}
function start() { if (start._on) return; start._on = true; setTimeout(tick, 90 * 1000); setInterval(tick, 20 * 60 * 1000); }

module.exports = { init, register, run, reports, status, start, inventory, fingerprint, diff };
