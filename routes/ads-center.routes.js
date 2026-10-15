// HolyOS — Centrum reklamy (sekce Soukromé, jen Tomáš + Jan Holý): přehled všech veřejných
// záchytných stránek a jejich výsledků (návštěvy, leady, objednávky, platby) za zvolené období.
// Zdroje: CompounderEvent (page_view / misto_view / lok_view), CompounderLead, PradlomatSpotInquiry,
// ShopOrder a Best Series 2.0 (přes /api/holyos/ads-stats, JWT se sdíleným BS2_SSO_SECRET).
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { bs2Allowed } = require('./auth.routes');

router.use(requireAuth);
router.use((req, res, next) => { SHIFT_ALS.run({ shift: parseShift(req.query.shift) }, next); });
router.use(async (req, res, next) => { try { if (!(await bs2Allowed(req.user))) return res.status(403).json({ error: 'Do této sekce nemáš přístup.' }); next(); } catch (e) { next(e); } });

// Definice záchytných stránek. visits = jak se počítají unikátní návštěvníci (událost + cesta),
// leads = jak se počítají leady/objednávky. bs2 = data z Best Series 2.0.
const PAGES = [
  { key: 'bs2_location', name: 'Prověření lokality', url: 'https://www.bestseries2.cz/location', desc: 'Prodejní stránka online aplikace (balíčky Základ / Plus / Premium, platba Stripe).', admin: 'https://www.bestseries2.cz/admin/online', color: '#4fd1ff', bs2: { path: '/location' }, leadLabel: 'objednávky', convLabel: 'zaplaceno' },
  { key: 'bs2_findlocation', name: 'Vyhledávač míst', url: 'https://www.bestseries2.cz/findlocation', desc: 'Záchytná stránka aplikace Vyhledávač míst (hero „Najděte nejlepší místo za pár minut", balíčky, platba Stripe).', admin: 'https://www.bestseries2.cz/admin/online', color: '#2fe3a0', bs2: { path: '/findlocation' } },
  { key: 'bs2_home', name: 'Best Series 2.0 – teaser /home', url: 'https://www.bestseries2.cz/home', desc: 'Úvodní teaser s odpočtem a sběrem e-mailů.', admin: 'https://www.bestseries2.cz/admin', color: '#7c5cff', bs2: { path: '/home' } },
  { key: 'misto', name: 'První prádlomat: prověř místo', url: 'https://pradlomaty.info/misto', desc: 'Veřejná stránka s balíčky prověření místa (žádosti + Stripe).', admin: '/modules/prodejni-objednavky/index.html', color: '#2fe3a0', visits: { event: 'misto_view' }, leads: { source: ['misto'] }, leadLabel: 'žádosti' },
  { key: 'compounder', name: 'Compounder.world', url: 'https://compounder.world', desc: 'Brandový web Compounderu – registrace leadů, portál, AI specialista.', admin: '/modules/prodejni-objednavky/index.html', color: '#f59e0b', visits: { event: 'page_view', pathNot: ['/misto', '/cesta', '/location', '/home'] }, leads: { source: ['web', 'google_ads', 'facebook', 'fb', 'fb_lead_ads', 'google'] }, leadLabel: 'leady' },
  { key: 'specialist', name: 'AI specialista (chat)', url: 'https://pradlomaty.info/ai', desc: 'Osobní AI specialista na prádlomaty – chat/hlas, odpovídá na vše (odkaz z SMS / e-mailu).', admin: '/modules/prodejni-objednavky/index.html', color: '#4fd1ff', visits: { event: 'page_view', pathIn: ['/ai'] } },
  { key: 'cesta', name: 'Cesta k rozhodnutí (pradlomaty /home, /cesta)', url: 'https://pradlomaty.info/home', desc: 'Modrá „cesta k rozhodnutí" pro zájemce o prádlomat.', admin: '/modules/prodejni-objednavky/index.html', color: '#1e86e0', visits: { event: 'page_view', pathIn: ['/home', '/cesta'] } },
  { key: 'lokality', name: 'Lokality – bestseries.global', url: 'https://bestseries.global', desc: 'Veřejná nabídka míst pro prádlomat (předjednaná místa).', admin: '/modules/prodejni-objednavky/index.html', color: '#a78bfa', visits: { event: 'lok_view' }, inquiries: true, leadLabel: 'poptávky' },
  { key: 'spare', name: 'Spare Parts Shop', url: 'https://bestseries.cash/spare-parts', desc: 'E-shop náhradních dílů (EUR).', admin: '/modules/eshop/index.html', color: '#22d3ee', visits: { event: 'shop_view' }, shop: true, leadLabel: 'objednávky' },
];

// days=0 → dnes od půlnoci; shift = posun o N dní zpět (včera = days 1, shift 1) → Date nese i .until (konec okna)
const { AsyncLocalStorage } = require('async_hooks'); const SHIFT_ALS = new AsyncLocalStorage(); // posun období per požadavek (bez sdílené proměnné)
function sinceDate(days, shift) { const sh = shift != null ? shift : ((SHIFT_ALS.getStore() || {}).shift || 0); const d = new Date(); d.setHours(0, 0, 0, 0); if (days > 0) d.setDate(d.getDate() - days + 1); if (sh > 0) { d.setDate(d.getDate() - sh); const u = new Date(d); u.setDate(u.getDate() + Math.max(1, days)); d.until = u; } return d; }
function rng(since) { return since && since.until ? { gte: since, lt: since.until } : { gte: since }; }
function parseShift(q) { const v = parseInt(q, 10); return isNaN(v) ? 0 : Math.min(3650, Math.max(0, v)); }
function parseDays(q, def) { const v = parseInt(q, 10); return isNaN(v) ? def : Math.min(3650, Math.max(0, v)); }
function dayKey(d) { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }
function dayKeys(days) { const out = []; const s = sinceDate(days); for (let i = 0; i < days; i++) { const d = new Date(s); d.setDate(s.getDate() + i); out.push(dayKey(d)); } return out; }

// Unikátní návštěvníci (sid) po dnech podle definice události/cesty
async function visitSeries(def, days) {
  const since = sinceDate(days);
  const where = { event: def.event, created_at: rng(since) };
  if (def.pathIn) where.OR = def.pathIn.map((p) => ({ path: { startsWith: p } }));
  const rows = await prisma.compounderEvent.findMany({ where, select: { sid: true, path: true, created_at: true } });
  const perDay = {}; const all = new Set();
  rows.forEach((r) => {
    if (def.pathNot && def.pathNot.some((p) => String(r.path || '').startsWith(p))) return;
    const k = dayKey(r.created_at); (perDay[k] = perDay[k] || new Set()).add(r.sid); all.add(r.sid);
  });
  return { series: dayKeys(days).map((k) => ({ d: k, n: perDay[k] ? perDay[k].size : 0 })), uniques: all.size };
}

async function bs2Stats(days, since, path) {
  const secret = process.env.BS2_SSO_SECRET, base = String(process.env.BS2_URL || 'https://www.bestseries2.cz').replace(/\/$/, '');
  if (!secret) return null;
  const token = jwt.sign({ aud: 'bs2-api', iss: 'holyos' }, secret, { expiresIn: '1m' });
  const r = await fetch(base + '/api/holyos/ads-stats?days=' + days + (since ? '&since=' + encodeURIComponent(since.toISOString()) : '') + (since && since.until ? '&until=' + encodeURIComponent(since.until.toISOString()) : '') + (path ? '&path=' + encodeURIComponent(path) : ''), { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('BS2 ' + r.status);
  return r.json();
}

// GET /api/ads-center/overview?days=30
// Sestavení přehledu stránek za období (sdílí overview i detailní statistika stránky)
async function buildOverview(days, sinceExact, onlyKey) {
    const since = sinceExact || sinceDate(days);
    let bs2 = null, bs2Err = null; try { bs2 = await bs2Stats(Math.max(1, days + 1), sinceExact || (since.until ? since : null)); } catch (e) { bs2Err = e.message; }
    const leadsBySource = await prisma.compounderLead.groupBy({ by: ['source'], where: { created_at: rng(since) }, _count: { _all: true } }).catch(() => []);
    const leadsByDay = await prisma.compounderLead.findMany({ where: { created_at: rng(since) }, select: { source: true, created_at: true } }).catch(() => []);
    const inquiries = await prisma.pradlomatSpotInquiry.findMany({ where: { created_at: rng(since) }, select: { created_at: true } }).catch(() => []);
    const shop = await prisma.shopOrder.findMany({ where: { created_at: rng(since) }, select: { created_at: true, total_incl_vat: true, status: true } }).catch(() => []);
    const out = [];
    for (const p of PAGES) {
      const item = { key: p.key, name: p.name, url: p.url, desc: p.desc, admin: p.admin, color: p.color, leadLabel: p.leadLabel || 'leady', convLabel: p.convLabel || null, visits: null, uniques: null, series: dayKeys(days).map((d) => ({ d, n: 0 })), leads: null, leadsSeries: null, conversions: null, revenue: null, note: null };
      if (p.bs2) {
        if (bs2) {
          const vs = (bs2.visits || []).filter((v) => v.path === p.bs2.path); const map = {}; vs.forEach((v) => { map[v.d] = v.n; });
          item.series = dayKeys(days).map((d) => ({ d, n: map[d] || 0 })); item.visits = vs.reduce((a, v) => a + v.n, 0);
          const u = (bs2.uniques || []).find((x) => x.path === p.bs2.path); item.uniques = u ? u.n : 0;
          if (p.key === 'bs2_location') { item.leads = Number(bs2.orders.total || 0); item.conversions = Number(bs2.orders.paid || 0); item.revenue = Number(bs2.orders.revenue || 0); item.note = bs2.customers + ' zákazníků s balíčkem · ' + bs2.logins + ' přihlášených za období'; const m = {}; (bs2.ordersByDay || []).forEach((o) => { m[o.d] = o.n; }); item.leadsSeries = dayKeys(days).map((d) => ({ d, n: m[d] || 0 })); }
        } else item.note = 'Best Series 2.0 nedostupné' + (bs2Err ? ' (' + bs2Err + ')' : '');
      }
      if (p.visits) { const v = await visitSeries(p.visits, days); item.series = v.series; item.uniques = v.uniques; item.visits = v.series.reduce((a, x) => a + x.n, 0); }
      if (p.leads) {
        const srcs = new Set(p.leads.source);
        item.leads = leadsBySource.filter((g) => srcs.has(g.source)).reduce((a, g) => a + g._count._all, 0);
        const m = {}; leadsByDay.filter((l) => srcs.has(l.source)).forEach((l) => { const k = dayKey(l.created_at); m[k] = (m[k] || 0) + 1; });
        item.leadsSeries = dayKeys(days).map((d) => ({ d, n: m[d] || 0 }));
      }
      if (p.inquiries) { item.leads = inquiries.length; const m = {}; inquiries.forEach((l) => { const k = dayKey(l.created_at); m[k] = (m[k] || 0) + 1; }); item.leadsSeries = dayKeys(days).map((d) => ({ d, n: m[d] || 0 })); }
      if (p.shop) { item.leads = shop.length; item.conversions = shop.filter((o) => o.status !== 'cancelled').length; item.revenue = shop.filter((o) => o.status !== 'cancelled').reduce((a, o) => a + Number(o.total_incl_vat || 0), 0); item.currency = 'EUR'; const m = {}; shop.forEach((l) => { const k = dayKey(l.created_at); m[k] = (m[k] || 0) + 1; }); item.leadsSeries = dayKeys(days).map((d) => ({ d, n: m[d] || 0 })); }
      if (item.visits != null && item.leads != null && item.visits > 0) item.conv_rate = Math.round(item.leads / Math.max(1, item.uniques || item.visits) * 1000) / 10;
      out.push(item);
    }
    return { pages: out, bs2 };
}
router.get('/overview', async (req, res, next) => {
  try {
    let days = parseDays(req.query.days, 30); let sinceExact = null;
    if (req.query.since && !isNaN(new Date(req.query.since))) { sinceExact = new Date(req.query.since); const s0 = new Date(sinceExact); s0.setHours(0, 0, 0, 0); const t0 = new Date(); t0.setHours(0, 0, 0, 0); days = Math.max(0, Math.round((t0 - s0) / 86400000)); } // ?since= → období od přesného času
    const o = await buildOverview(days, sinceExact);
    res.json({ days, generatedAt: new Date().toISOString(), pages: o.pages });
  } catch (err) { next(err); }
});

// ── Živě: kdo je právě na stránce a co dělá (jen BS2 stránky). GET /pages/:key/live
router.get('/pages/:key/live', async (req, res, next) => {
  try {
    const pg = PAGES.find((x) => x.key === String(req.params.key || '')); if (!pg) return res.status(404).json({ error: 'Stránka neexistuje.' });
    if (!pg.bs2 || !pg.bs2.path) return res.json({ supported: false });
    const secret = process.env.BS2_SSO_SECRET, base = String(process.env.BS2_URL || 'https://www.bestseries2.cz').replace(/\/$/, '');
    if (!secret) return res.json({ supported: false });
    const token = jwt.sign({ aud: 'bs2-api', iss: 'holyos' }, secret, { expiresIn: '1m' });
    const r = await fetch(base + '/api/holyos/ads-live?path=' + encodeURIComponent(pg.bs2.path), { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return res.status(502).json({ error: 'BS2 ' + r.status });
    res.json(Object.assign({ supported: true }, await r.json()));
  } catch (err) { next(err); }
});

// ── Detailní statistika záchytné stránky (pro marketing): období vs. předchozí období, denní řady, hodiny/dny v týdnu,
//    zařízení, zdroje (utm / kanál funelu), balíčky (BS2), cíle. GET /pages/:key/stats?days&shift
router.get('/pages/:key/stats', async (req, res, next) => {
  try {
    const key = String(req.params.key || ''); const p = PAGES.find((x) => x.key === key); if (!p) return res.status(404).json({ error: 'Stránka nenalezena' });
    const days = parseDays(req.query.days, 30); const shift = parseShift(req.query.shift); const span = Math.max(1, days);
    const since = sinceDate(days); const until = since.until || new Date();
    const curO = await buildOverview(days, null); const cur = curO.pages.find((x) => x.key === key); if (!cur) return res.status(404).json({ error: 'Stránka nenalezena' });
    const prevO = await SHIFT_ALS.run({ shift: shift + span }, () => buildOverview(days, null)); const prev = prevO.pages.find((x) => x.key === key);
    // denní řada: návštěvy, leady (+ BS2: zaplaceno, tržba po dnech)
    const keys = dayKeys(days); const vm = {}; (cur.series || []).forEach((x) => { vm[x.d] = x.n; }); const lm = {}; (cur.leadsSeries || []).forEach((x) => { lm[x.d] = x.n; });
    const pm = {}, rm = {}; const bs2 = curO.bs2;
    if (p.key === 'bs2_location' && bs2) { (bs2.ordersByDay || []).forEach((o) => { pm[o.d] = o.paid; }); (bs2.revenueByDay || []).forEach((o) => { rm[o.d] = Number(o.revenue) || 0; }); }
    const daily = keys.map((d) => ({ d, visits: vm[d] || 0, leads: lm[d] || 0, paid: pm[d] || 0, revenue: rm[d] || 0 }));
    // události stránky (HolyOS tracking): hodiny, dny v týdnu, zařízení, zdroje
    const hours = new Array(24).fill(0), weekdays = new Array(7).fill(0); const devices = { mobile: 0, desktop: 0, other: 0 }; const sources = {};
    if (p.visits) {
      const where = { event: p.visits.event, created_at: rng(since) }; if (p.visits.pathIn) where.OR = p.visits.pathIn.map((x) => ({ path: { startsWith: x } }));
      const rows = await prisma.compounderEvent.findMany({ where, select: { sid: true, path: true, props: true, ua: true, created_at: true } });
      const seen = new Set();
      rows.forEach((r) => { if (p.visits.pathNot && p.visits.pathNot.some((x) => String(r.path || '').startsWith(x))) return; const t = new Date(r.created_at); hours[t.getHours()]++; weekdays[(t.getDay() + 6) % 7]++;
        if (!seen.has(r.sid)) { seen.add(r.sid); const ua = String(r.ua || ''); devices[/Mobi|Android|iPhone|iPad/i.test(ua) ? 'mobile' : (ua ? 'desktop' : 'other')]++; const pr = r.props || {}; const src = pr.utm_source || pr.source || pr.ref || pr.referrer || (pr.url && /[?&]utm_source=([^&]+)/.exec(pr.url) ? decodeURIComponent(/[?&]utm_source=([^&]+)/.exec(pr.url)[1]) : null) || 'přímo / neznámé'; sources[src] = (sources[src] || 0) + 1; } });
    }
    // příchody z funelů (klik ze SMS / e-mailu na tuto stránku) + lead_id → kolik leadů
    const fl = await prisma.compounderEvent.findMany({ where: { event: 'funnel_landing', created_at: rng(since), path: { startsWith: '/funnel/' } }, select: { props: true, created_at: true } }).catch(() => []);
    const channel = { sms: new Set(), email: new Set() }; fl.forEach((r) => { const pr = r.props || {}; if (pr.pageKey !== key) return; const ch = pr.channel === 'email' ? 'email' : 'sms'; channel[ch].add(pr.lead_id); });
    // BS2: balíčky, hodiny objednávek
    let packages = null, orderHours = null; if (p.key === 'bs2_location' && bs2) { packages = bs2.ordersByPackage || null; orderHours = bs2.orderHours || null; }
    // chování návštěvníků na stránce (BS2 sledování: scroll, sekce, čas, kliky, myš, odchod)
    let behavior = null; if (p.bs2 && p.bs2.path) { try { const b2 = await bs2Stats(Math.max(1, days + 1), since.until ? since : (days === 0 ? since : null), p.bs2.path); behavior = b2 && b2.behavior ? b2.behavior : null; } catch (e) { behavior = null; } }
    // verze stránky (log úprav) v období + poslední
    let versions = []; try { versions = (await require('../services/ads/page-watch').versions(key)).slice(-30).reverse(); } catch (e) { versions = []; }
    // cíle stránky s čísly (z uložených cílů; počty tam, kde je umíme spočítat)
    let goals = null; try { const G = (await loadGoals())[key]; if (G && G.goals) goals = G.goals.map((g) => ({ label: g.label, type: g.type, primary: !!g.primary, count: g.type === 'purchase' && cur.conversions != null ? cur.conversions : (g.type === 'lead' && cur.leads != null ? cur.leads : null) })); } catch (e) { goals = null; }
    const pct = (a, b) => (b > 0 ? Math.round(a / b * 1000) / 10 : null);
    const sum = (x) => ({ visits: x.visits, uniques: x.uniques, leads: x.leads, conversions: x.conversions, revenue: x.revenue, conv_rate: x.conv_rate != null ? x.conv_rate : pct(x.leads || 0, x.uniques || x.visits || 0), paid_rate: pct(x.conversions || 0, x.leads || 0), rev_per_visitor: x.revenue != null && (x.uniques || x.visits) ? Math.round(x.revenue / (x.uniques || x.visits)) : null });
    res.json({ page: { key: p.key, name: p.name, url: p.url, color: p.color, leadLabel: p.leadLabel || 'leady', convLabel: p.convLabel || 'dokončeno', currency: cur.currency || 'CZK' }, period: { days, shift, since: since.toISOString(), until: until.toISOString() }, now: sum(cur), prev: prev ? sum(prev) : null, daily, hours, weekdays, devices, sources: Object.keys(sources).map((k) => ({ name: k, n: sources[k] })).sort((a, b) => b.n - a.n).slice(0, 12), funnel: { sms: channel.sms.size, email: channel.email.size }, packages, orderHours, goals, behavior, versions, note: cur.note || null });
  } catch (err) { next(err); }
});

// ── Funely: uživatelsky definované posloupnosti kroků (stránka + metrika), uloženo v AppSetting ──
const FUNNELS_KEY = 'ads_center.funnels';
const METRICS = ['uniques', 'leads', 'conversions'];
async function loadFunnels() { const { getSetting } = require('../services/settings'); const v = await getSetting(FUNNELS_KEY, { type: 'json', defaultValue: [] }); return Array.isArray(v) ? v : []; }
function cleanFunnel(f) {
  const keys = new Set(PAGES.map((p) => p.key));
  const cleanStep = (st) => ({ label: String(st.label || '').slice(0, 60), page: keys.has(st.page) ? st.page : null, metric: METRICS.includes(st.metric) ? st.metric : 'uniques', manual: st.manual != null && st.manual !== '' ? Number(st.manual) : null });
  // Vizuální editor: nodes (uzly s pozicí) + edges (spojnice). Kroky funelu se odvodí průchodem řetězce od uzlu bez vstupu.
  const nodes = (Array.isArray(f.nodes) ? f.nodes : []).slice(0, 60).map((nd) => Object.assign(cleanStep(nd), { id: String(nd.id || '').slice(0, 24), x: Math.round(Number(nd.x) || 0), y: Math.round(Number(nd.y) || 0), kind: ['note', 'start', 'leadform', 'split', 'sms', 'email', 'landing', 'goals', 'result', 'db', 'list'].includes(nd.kind) ? nd.kind : 'step', cond: nd.kind === 'list' && nd.cond && typeof nd.cond === 'object' ? JSON.parse(JSON.stringify(nd.cond).slice(0, 2000)) : undefined, seg: (nd.kind === 'db' || nd.kind === 'list') && nd.seg && typeof nd.seg === 'object' ? { base: nd.seg.base === 'form' ? 'form' : 'all', lists: (Array.isArray(nd.seg.lists) ? nd.seg.lists : []).slice(0, 12).map((l) => ({ name: String(l.name || '').slice(0, 60), cond: l.cond && typeof l.cond === 'object' ? JSON.parse(JSON.stringify(l.cond).slice(0, 2000)) : {} })) } : undefined, groups: nd.kind === 'leadform' && Array.isArray(nd.groups) ? nd.groups.slice(0, 12).map((g) => ({ name: String((g && g.name) || '').slice(0, 60), ad_ids: (Array.isArray(g && g.ad_ids) ? g.ad_ids : []).map((x) => String(x).replace(/[^0-9]/g, '')).filter(Boolean).slice(0, 200) })) : undefined, goals_open: ['landing', 'sms', 'email', 'goals', 'db', 'list', 'leadform'].includes(nd.kind) ? !!nd.goals_open : undefined, goals_on: ['sms', 'email'].includes(nd.kind) ? !!nd.goals_on : undefined, goals_hide: ['sms', 'email'].includes(nd.kind) ? (Array.isArray(nd.goals_hide) ? nd.goals_hide.map(String).slice(0, 8) : []) : undefined, goal_names: ['sms', 'email'].includes(nd.kind) && nd.goal_names && typeof nd.goal_names === 'object' ? Object.fromEntries(Object.entries(nd.goal_names).slice(0, 8).map(([k, v]) => [String(k).slice(0, 20), String(v || '').slice(0, 60)])) : undefined, stats_from: ['sms', 'email', 'landing'].includes(nd.kind) && nd.stats_from && !isNaN(new Date(nd.stats_from)) ? new Date(nd.stats_from).toISOString() : null, goals: ['goals', 'landing', 'sms', 'email'].includes(nd.kind) ? (Array.isArray(nd.goals) ? nd.goals : []).slice(0, 12).map((g) => ({ type: String(g.type || 'browse').slice(0, 20), label: String(g.label || '').slice(0, 80), desc: String(g.desc || '').slice(0, 300), primary: !!g.primary })) : undefined, goal_type: nd.kind === 'result' ? String(nd.goal_type || '').slice(0, 20) : undefined, port_from: nd.kind === 'result' ? Math.max(0, Math.min(19, parseInt(nd.port_from, 10) || 0)) : undefined, variant: ['sms', 'email', 'landing'].includes(nd.kind) ? (nd.variant === 'schuzka' ? 'schuzka' : 'specialist') : undefined, branches: nd.kind === 'split' ? (Array.isArray(nd.branches) ? nd.branches : []).slice(0, 20).map((b) => ({ key: String(b.key || '').slice(0, 24), count: Math.max(0, Math.min(999, parseInt(b.count, 10) || 0)) })) : undefined, merges: nd.kind === 'split' ? (Array.isArray(nd.merges) ? nd.merges : []).slice(0, 9).map((m) => ({ name: String(m.name || '').slice(0, 40), ports: (Array.isArray(m.ports) ? m.ports : []).map((x) => parseInt(x, 10)).filter((x) => x >= 0 && x < 10).slice(0, 10) })) : undefined, text: String(nd.text || '').slice(0, 300), enabled: nd.enabled === false ? false : true, activated_at: nd.activated_at ? String(nd.activated_at).slice(0, 40) : null, deactivated_at: nd.deactivated_at ? String(nd.deactivated_at).slice(0, 40) : null, form: nd.kind === 'leadform' && nd.form ? { form_id: nd.form.form_id ? String(nd.form.form_id).slice(0, 40) : null, name: String(nd.form.name || '').slice(0, 120), status: String(nd.form.status || '').slice(0, 30), questions: (Array.isArray(nd.form.questions) ? nd.form.questions : []).slice(0, 8).map((q) => String(q).slice(0, 60)), leads: Number(nd.form.leads) || 0, clicks: Number(nd.form.clicks) || 0, spend: Number(nd.form.spend) || 0, campaign_id: String(nd.form.campaign_id || '').slice(0, 40), campaign_name: String(nd.form.campaign_name || '').slice(0, 120), ad_ids: (Array.isArray(nd.form.ad_ids) ? nd.form.ad_ids : []).slice(0, 200).map((x) => String(x).replace(/[^0-9]/g, '')).filter(Boolean) } : undefined, meta: nd.meta && nd.meta.campaign ? { account: String(nd.meta.account || '').replace(/[^0-9]/g, '').slice(0, 30), campaign: { id: String(nd.meta.campaign.id || '').slice(0, 40), name: String(nd.meta.campaign.name || '').slice(0, 120), status: String(nd.meta.campaign.status || '').slice(0, 40), impressions: Number(nd.meta.campaign.impressions) || 0, reach: Number(nd.meta.campaign.reach) || 0, link_clicks: Number(nd.meta.campaign.link_clicks) || 0, leads: Number(nd.meta.campaign.leads) || 0, spend: Number(nd.meta.campaign.spend) || 0, endpoint: String(nd.meta.campaign.endpoint || '').slice(0, 300) } } : null }));
  const ids = new Set(nodes.map((x) => x.id));
  const edges = (Array.isArray(f.edges) ? f.edges : []).slice(0, 120).map((e) => ({ from: String(e.from || ''), to: String(e.to || ''), port: Math.max(0, Math.min(19, parseInt(e.port, 10) || 0)), created_at: e.created_at ? String(e.created_at).slice(0, 40) : undefined })).filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  let steps = (Array.isArray(f.steps) ? f.steps : []).slice(0, 12).map(cleanStep);
  if (nodes.length) {
    const hasIn = new Set(edges.map((e) => e.to)); const stepNodes = nodes.filter((x) => x.kind !== 'note');
    let cur = stepNodes.find((x) => x.kind === 'start') || stepNodes.find((x) => !hasIn.has(x.id)); const seen = new Set(); steps = [];
    while (cur && !seen.has(cur.id) && steps.length < 12) { seen.add(cur.id); steps.push(Object.assign(cleanStep(cur), cur.kind === 'start' ? { label: cur.label || 'Facebook reklama', page: null } : {})); const e = edges.find((ed) => ed.from === cur.id); cur = e ? nodes.find((x) => x.id === e.to && x.kind !== 'note' && !['sms', 'email', 'landing'].includes(x.kind)) : null; }
  }
  return { id: String(f.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 40), name: String(f.name || 'Funel').slice(0, 80), note: String(f.note || '').slice(0, 300), steps, nodes, edges, backfilled_at: f.backfilled_at ? String(f.backfilled_at).slice(0, 40) : undefined };
}
router.get('/funnels', async (req, res, next) => { try { res.json(await loadFunnels()); } catch (err) { next(err); } });
router.put('/funnels', express.json({ limit: '200kb' }), async (req, res, next) => {
  try {
    const { setSetting } = require('../services/settings');
    const list = (Array.isArray(req.body) ? req.body : []).slice(0, 50).map(cleanFunnel);
    await setSetting(FUNNELS_KEY, list, { type: 'json', description: 'Centrum reklamy – definice funelů', scope: 'marketing', userId: req.user && req.user.id }); try { require('../services/ads/funnel-events').invalidate(); } catch (_) { /* cache */ }
    // Cílové stránky variant (specialista / schůzka) pro automatické SMS a e-maily se odvozují z plátna: zapnutý uzel SMS/e-mail → spojka → Záchytná stránka
    // se stránkou z Centra reklamy. Uloží se do compounder.aispec_autosend.landing, aby odkaz {link} ve zprávách vedl tam, kam ukazuje funel (bez nutnosti „Uložit nastavení“).
    try { const { getSetting } = require('../services/settings'); const landing = { specialist: '', schuzka: '' };
      list.forEach((f) => { const byId = {}; (f.nodes || []).forEach((nd) => { byId[nd.id] = nd; }); (f.nodes || []).forEach((nd) => { if (!['sms', 'email'].includes(nd.kind) || nd.enabled === false) return; const vr = nd.variant === 'schuzka' ? 'schuzka' : 'specialist'; if (landing[vr]) return; (f.edges || []).forEach((e) => { if (e.from !== nd.id) return; const t = byId[e.to]; if (t && t.kind === 'landing' && t.enabled !== false && t.page) { const pg = PAGES.find((p) => p.key === t.page); if (pg && /^https:\/\//.test(pg.url) && !landing[vr]) landing[vr] = pg.url; } }); }); });
      const cur = (await getSetting('compounder.aispec_autosend', { type: 'json', defaultValue: null })) || {}; const prevL = Object.assign({ specialist: '', schuzka: '' }, cur.landing || {});
      if (prevL.specialist !== landing.specialist || prevL.schuzka !== landing.schuzka) { await setSetting('compounder.aispec_autosend', Object.assign({}, cur, { landing }), { type: 'json', description: 'Compounder – automatické oslovení (SMS/e-mail) – pravidla', scope: 'compounder', userId: req.user && req.user.id }); console.log('[ads-center] landing variant z funelu:', JSON.stringify(landing)); }
    } catch (e) { console.warn('[ads-center] landing sync', e.message); }
    res.json(list);
  } catch (err) { next(err); }
});
// Statistika běhu funelu per uzel (jen z událostí funelu, od aktivace uzlu, za období). days=0 → dnes.
router.get('/funnels/:id/stats', async (req, res, next) => { try { const days = parseDays(req.query.days, 30); const fe = require('../services/ads/funnel-events'); const st = await fe.stats(String(req.params.id || ''), sinceDate(days)); const ef = await fe.edgeFlows(String(req.params.id || ''), sinceDate(days), false); res.json({ days, nodes: st, edges: ef }); } catch (err) { next(err); } });
// Seznam leadů, které prošly spojkou from>to (jména + časy) – pro klik na štítek spojky.
router.get('/funnels/:id/edge-leads', async (req, res, next) => { try { const days = parseDays(req.query.days, 30); const ef = await require('../services/ads/funnel-events').edgeFlows(String(req.params.id || ''), sinceDate(days), true); const k = String(req.query.from || '') + '>' + String(req.query.to || '') + (parseInt(req.query.port, 10) > 0 ? '#' + parseInt(req.query.port, 10) : ''); const e = ef[k] || { leads: 0, list: [] }; const ids = (e.list || []).map((x) => x.lead_id); const leads = ids.length ? await prisma.compounderLead.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, phone: true, status: true, owner_person_id: true } }) : []; const byId = {}; leads.forEach((l) => { byId[l.id] = l; });
  // proč lead neprošel dál: poslední záznam automatu (outreach_skip / outreach_error) k leadovi
  const reason = {}; try { const ev = await prisma.compounderEvent.findMany({ where: { event: { in: ['outreach_skip', 'outreach_error'] }, path: '/autosend', created_at: rng(sinceDate(days)) }, orderBy: { created_at: 'desc' }, take: 2000, select: { event: true, props: true } }); ev.forEach((r) => { const lid = Number(r.props && r.props.lead_id); if (lid && ids.includes(lid) && !reason[lid]) reason[lid] = (r.event === 'outreach_error' ? '⚠ ' : '') + (r.props.variant || '') + ': ' + (r.props.reason || ''); }); } catch (e) { /* bez důvodů */ }
  // kde ve funelu lead právě je (nejzazší uzel s událostí) – „Stav" v seznamu = poloha ve funelu, CRM stav jen v tooltipu
  let pos = {}; try { pos = await require('../services/ads/funnel-events').positions(String(req.params.id || ''), sinceDate(days)); } catch (e2) { pos = {}; }
  const byIdN = {}; try { const fAll = await loadFunnels(); const f0 = fAll.find((x) => x.id === String(req.params.id || '')); ((f0 && f0.nodes) || []).forEach((nd) => { byIdN[nd.id] = nd; }); } catch (e3) { /* bez uzlů */ }
  res.json({ leads: e.leads, list: (e.list || []).map((x) => Object.assign({}, x, byId[x.lead_id] || {}, (function () { const B = byIdN[String(req.query.to || '')]; const ch = B && (B.kind === 'sms' || B.kind === 'email') ? B.kind : (B && B.kind === 'landing' ? (String(req.query.port || '') ? null : null) : null); const pk = ch ? pos[x.lead_id + '|' + ch] : (pos[x.lead_id] || pos[x.lead_id + '|sms'] || pos[x.lead_id + '|email']); const pp = pk || pos[x.lead_id] || null; const stuck = !!pos[x.lead_id] && !pos[x.lead_id + '|sms'] && !pos[x.lead_id + '|email']; return { reason: stuck ? (reason[x.lead_id] || '') : '', pos_node: pp ? pp.node : null, pos_t: pp ? pp.t : null }; })())).sort((a, b) => new Date(b.tB) - new Date(a.tB)) }); } catch (err) { next(err); } });
// Log odeslání uzlu (SMS / e-mail): seznam zpráv s textem, adresátem, doručením a reakcí – pro kontrolu z editoru funelu
router.get('/funnels/:id/node-log', async (req, res, next) => { try { const days = parseDays(req.query.days, 30); const list = await require('../services/ads/funnel-events').nodeLog(String(req.params.id || ''), String(req.query.node || ''), sinceDate(days)); res.json({ list }); } catch (err) { next(err); } });
// Testovací lead z editoru funelu: založí se jako lead z rychlého formuláře (stejná cesta jako napřímo z FB) → rozdělení, autosend, vlákna
router.post('/test-lead', async (req, res, next) => { try {
  const b = req.body || {}; const formId = String(b.form_id || '').trim(); if (!formId) return res.status(400).json({ error: 'Chybí formulář' });
  const first = String(b.first_name || '').trim(), last = String(b.last_name || '').trim(); const phone = String(b.phone || '').trim(), email = String(b.email || '').trim();
  if (!first || (!phone && !email)) return res.status(400).json({ error: 'Vyplň jméno a telefon nebo e-mail' });
  const cmp = require('./compounder.routes'); const forms = await cmp._fbLoadForms(); const fcfg = forms.find((f) => String(f.form_id) === formId) || null;
  const owner = await cmp._fbResolveOwner(fcfg || { form_id: formId });
  const fields = { first_name: first, last_name: last, full_name: (first + ' ' + last).trim(), phone, email, city: String(b.city || '').trim() };
  const tid = 'test-' + Date.now();
  const out = await cmp._fbCreateLead(fields, { leadId: tid, formId, pageId: null, adId: b.ad_id ? String(b.ad_id) : null, raw: { test: true, form_name: b.form_name || '', created_time: new Date().toISOString(), by: req.user && (req.user.username || req.user.id) }, source: 'facebook_ads', srcLabel: 'TEST z funelu', channelName: 'FB reklamy' }, Object.assign({ form_id: formId, form_name: b.form_name || '' }, fcfg || {}, owner));
  if (!out || !out.created) return res.status(400).json({ error: 'Lead se nezaložil' + (out && out.skipped ? ' (' + out.skipped + ')' : '') });
  try { const L = await prisma.compounderLead.findUnique({ where: { id: out.id }, select: { notes: true } }); await prisma.compounderLead.update({ where: { id: out.id }, data: { notes: 'TEST z funelu – ' + new Date().toLocaleString('cs-CZ') + (L && L.notes ? '\n' + L.notes : '') } }); } catch (e) { /* poznámka je nepovinná */ }
  let ownerName = null; try { if (owner && owner.owner_person_id) { const p = await prisma.person.findUnique({ where: { id: owner.owner_person_id }, select: { first_name: true, last_name: true } }); if (p) ownerName = ((p.first_name || '') + ' ' + (p.last_name || '')).trim(); } } catch (e) { /* bez jména */ }
  res.json({ ok: true, id: out.id, owner: ownerName });
} catch (err) { next(err); } });
router.get('/funnels/:id/positions', async (req, res, next) => { try { const days = parseDays(req.query.days, 30); const positions = await require('../services/ads/funnel-events').positions(String(req.params.id || ''), sinceDate(days)); res.json({ positions }); } catch (err) { next(err); } });
// Ruční spuštění automatu pro lead zastavený ve funelu (např. doplněný telefon)
router.post('/leads/:id/autosend', async (req, res, next) => { try { const r = await require('./compounder.routes').rerunAutosend(parseInt(req.params.id, 10)); res.json(r); } catch (err) { next(err); } });
// Dodatečné odeslání z vlákna: { ids:[lead_id], channel:'sms'|'email', force:bool } → pošle po jednom, vrátí výsledky
router.post('/leads/resend', async (req, res, next) => { try { const b = req.body || {}; const ids = (Array.isArray(b.ids) ? b.ids : []).map((x) => parseInt(x, 10)).filter((x) => x > 0).slice(0, 200); const ch = b.channel === 'email' ? 'email' : 'sms'; const cmp = require('./compounder.routes'); const out = []; for (const id of ids) { try { const r = await cmp.forceSend(id, ch, !!b.force); out.push({ id, sent: !!(r && r.sent), error: r && (r.error || (!r.sent ? r.reason : '')) }); } catch (e) { out.push({ id, sent: false, error: e.message }); } } res.json({ ok: true, results: out, sent: out.filter((x) => x.sent).length }); } catch (err) { next(err); } });
// ── Kompletní statistika funelu (pro marketing): reklama → formulář → rozdělení → SMS/e-mail → stránka → objednávky,
//    s konverzemi mezi kroky, porovnáním s předchozím obdobím, rozpadem po obchodnících a denní řadou. GET /funnels/:id/report?days&shift
async function funnelReport(req, days, shift, funnel) {
  const since = sinceDate(days); const until = since.until || new Date(); const span = Math.max(1, days);
  const nodes = funnel.nodes || [], edges = funnel.edges || []; const byId = {}; nodes.forEach((nd) => { byId[nd.id] = nd; });
  const FE = require('../services/ads/funnel-events');
  const [stats, flows] = await Promise.all([FE.stats(funnel.id, since).catch(() => ({})), FE.edgeFlows(funnel.id, since, false).catch(() => ({}))]);
  // 1) reklama: Meta insights kampaní napojených na start (přesný časový rozsah)
  const ads = { impressions: 0, reach: 0, clicks: 0, link_clicks: 0, spend: 0, campaigns: [] }; let adsOk = false;
  try { const c = await metaCfg(req); const starts = nodes.filter((nd) => nd.kind === 'start' && nd.meta && nd.meta.campaign && nd.meta.campaign.id);
    if (c.token && starts.length) { const d1 = new Date(until.getTime() - 1); const tr = JSON.stringify({ since: dayKey(since), until: dayKey(d1) });
      for (const nd of starts) { try { const j = await graph(String(nd.meta.campaign.id).replace(/[^0-9]/g, '') + '/insights', { fields: 'impressions,reach,clicks,spend,actions', time_range: tr }, c.token); const ins = (j.data && j.data[0]) || {}; const act = (t) => { const a = (ins.actions || []).find((x) => x.action_type === t); return a ? Number(a.value) : 0; };
        const row = { id: nd.meta.campaign.id, name: nd.meta.campaign.name, impressions: Number(ins.impressions || 0), reach: Number(ins.reach || 0), clicks: Number(ins.clicks || 0), link_clicks: act('link_click'), spend: Number(ins.spend || 0), meta_leads: act('lead') || act('onsite_conversion.lead_grouped') };
        ads.campaigns.push(row); ads.impressions += row.impressions; ads.reach += row.reach; ads.clicks += row.clicks; ads.link_clicks += row.link_clicks; ads.spend += row.spend; adsOk = true; } catch (e) { ads.campaigns.push({ id: nd.meta.campaign.id, name: nd.meta.campaign.name, error: e.message }); } } } } catch (e) { /* bez Mety */ }
  // 2) formuláře: leady v HolyOS (+ denně, + po obchodnících, + zdroj napřímo/Make)
  const forms = nodes.filter((nd) => nd.kind === 'leadform' && nd.form && nd.form.form_id); let leads = []; const formRows = [];
  for (const nd of forms) { const adIds = (nd.form.ad_ids || []).map(String).filter(Boolean); const or = [{ meta_form_id: String(nd.form.form_id) }].concat(adIds.length ? [{ meta_ad_id: { in: adIds } }] : []);
    const L = await prisma.compounderLead.findMany({ where: { OR: or, created_at: rng(since) }, select: { id: true, created_at: true, owner_person_id: true, external_rep_id: true, status: true, phone: true, email: true, activity_log: true } }).catch(() => []);
    formRows.push({ node: nd.id, name: nd.form.name || nd.form.form_id, leads: L.length, direct: L.filter((r) => /napřímo/.test(String(r.activity_log || '').split('\n')[0])).length, no_phone: L.filter((r) => !r.phone).length, no_email: L.filter((r) => !r.email).length }); leads = leads.concat(L); }
  const leadIds = new Set(leads.map((l) => l.id));
  // 3) rozdělení po obchodnících
  const byOwner = {}; leads.forEach((l) => { const k = l.owner_person_id ? 'i:' + l.owner_person_id : (l.external_rep_id ? 'e:' + l.external_rep_id : 'none'); byOwner[k] = (byOwner[k] || 0) + 1; });
  const pids = Object.keys(byOwner).filter((k) => k.startsWith('i:')).map((k) => Number(k.slice(2))); const persons = pids.length ? await prisma.person.findMany({ where: { id: { in: pids } }, select: { id: true, first_name: true, last_name: true } }).catch(() => []) : [];
  const nameOf = (k) => { if (k === 'none') return 'nepřiřazeno'; if (k.startsWith('i:')) { const p = persons.find((x) => x.id === Number(k.slice(2))); return p ? ((p.first_name || '') + ' ' + (p.last_name || '')).trim() : k; } return 'externí ' + k.slice(2); };
  // 4) kanály a stránky z uzlů (stats = per uzel)
  const chan = (kind) => nodes.filter((nd) => nd.kind === kind && nd.enabled !== false).map((nd) => { const st = stats[nd.id] || {}; return { node: nd.id, variant: nd.variant, sent: st.leads || 0, delivered: st.delivered, opened: st.opened, clicked: st.clicked || 0, noreact: st.noreact }; });
  const sms = chan('sms'), email = chan('email');
  const landing = nodes.filter((nd) => nd.kind === 'landing').map((nd) => { const st = stats[nd.id] || {}; const pg = PAGES.find((p) => p.key === nd.page); return { node: nd.id, name: pg ? pg.name : (nd.variant === 'schuzka' ? 'Cesta k rozhodnutí' : 'AI specialista'), key: nd.page || null, opened: st.leads || 0 }; });
  // 5) objednávky / tržby na záchytných stránkách (BS2 za období) + po dnech
  let orders = null; const lkeys = landing.map((x) => x.key).filter(Boolean);
  if (lkeys.includes('bs2_location')) { try { const b = await bs2Stats(Math.max(1, days + 1), since.until ? since : null); if (b) orders = { total: Number(b.orders.total || 0), paid: Number(b.orders.paid || 0), revenue: Number(b.orders.revenue || 0), byDay: b.ordersByDay || [], revenueByDay: b.revenueByDay || [], byPackage: b.ordersByPackage || [] }; } catch (e) { orders = null; } }
  // 6) denní řada: leady, SMS, e-maily, kliky, objednávky
  const ev = await prisma.compounderEvent.findMany({ where: { event: { in: ['funnel_sms', 'funnel_email', 'funnel_landing'] }, path: { startsWith: '/funnel/' + funnel.id + '/' }, created_at: rng(since) }, select: { event: true, props: true, created_at: true } }).catch(() => []);
  const keys = dayKeys(days); const D = {}; keys.forEach((k) => { D[k] = { d: k, leads: 0, sms: 0, email: 0, clicks: 0, orders: 0, revenue: 0 }; });
  leads.forEach((l) => { const k = dayKey(l.created_at); if (D[k]) D[k].leads++; });
  const seenClick = new Set(); ev.forEach((r) => { const k = dayKey(r.created_at); if (!D[k]) return; const lid = r.props && r.props.lead_id; if (r.event === 'funnel_sms') D[k].sms++; else if (r.event === 'funnel_email') D[k].email++; else if (r.event === 'funnel_landing' && lid && !seenClick.has(lid + k)) { seenClick.add(lid + k); D[k].clicks++; } });
  if (orders) { orders.byDay.forEach((o) => { if (D[o.d]) D[o.d].orders += Number(o.paid || 0); }); orders.revenueByDay.forEach((o) => { if (D[o.d]) D[o.d].revenue += Number(o.revenue || 0); }); }
  // 7) kliky celkem (unikátní leady, které otevřely odkaz) + podle kanálu
  const clickers = { sms: new Set(), email: new Set() }; ev.forEach((r) => { if (r.event !== 'funnel_landing') return; const lid = r.props && r.props.lead_id; if (!lid) return; clickers[r.props.channel === 'email' ? 'email' : 'sms'].add(lid); });
  const clicked = new Set([...clickers.sms, ...clickers.email]).size;
  const totalSent = new Set(ev.filter((r) => r.event === 'funnel_sms' || r.event === 'funnel_email').map((r) => r.props && r.props.lead_id)).size;
  const pct = (a, b) => (b > 0 ? Math.round(a / b * 1000) / 10 : null);
  const kpi = { impressions: adsOk ? ads.impressions : null, reach: adsOk ? ads.reach : null, link_clicks: adsOk ? ads.link_clicks : null, spend: adsOk ? Math.round(ads.spend) : null, leads: leads.length, cpl: adsOk && leads.length ? Math.round(ads.spend / leads.length) : null, contacted: totalSent, contact_rate: pct(totalSent, leads.length), clicked, click_rate: pct(clicked, totalSent), orders: orders ? orders.paid : null, order_rate: orders ? pct(orders.paid, clicked) : null, revenue: orders ? orders.revenue : null, cpo: adsOk && orders && orders.paid ? Math.round(ads.spend / orders.paid) : null, roas: adsOk && orders && ads.spend > 0 ? Math.round(orders.revenue / ads.spend * 100) / 100 : null };
  return { period: { days, shift, since: since.toISOString(), until: until.toISOString() }, kpi, ads: adsOk ? ads : null, forms: formRows, owners: Object.keys(byOwner).map((k) => ({ key: k, name: nameOf(k), leads: byOwner[k] })).sort((a, b) => b.leads - a.leads), sms, email, clickers: { sms: clickers.sms.size, email: clickers.email.size }, landing, orders: orders ? { total: orders.total, paid: orders.paid, revenue: orders.revenue, byPackage: orders.byPackage } : null, daily: keys.map((k) => D[k]), flows };
}
router.get('/funnels/:id/report', async (req, res, next) => { try { const days = parseDays(req.query.days, 30); const shift = parseShift(req.query.shift); const f = (await loadFunnels()).find((x) => x.id === String(req.params.id || '')); if (!f) return res.status(404).json({ error: 'Funel nenalezen' });
  const now = await funnelReport(req, days, shift, f); let prev = null; try { prev = await SHIFT_ALS.run({ shift: shift + Math.max(1, days) }, () => funnelReport(req, days, shift + Math.max(1, days), f)); } catch (e) { prev = null; }
  res.json({ funnel: { id: f.id, name: f.name }, now, prev: prev ? { kpi: prev.kpi, period: prev.period } : null }); } catch (err) { next(err); } });
// ── Log úprav záchytné stránky (verze) ──
router.get('/pages/:key/versions', async (req, res, next) => { try { res.json({ versions: (await require('../services/ads/page-watch').versions(String(req.params.key || ''))).slice().reverse() }); } catch (err) { next(err); } });
router.post('/pages/:key/versions/check', async (req, res, next) => { try { const changed = await require('../services/ads/page-watch').check(PAGES.filter((p) => p.key === String(req.params.key || ''))); res.json({ ok: true, changed }); } catch (err) { next(err); } });
router.post('/pages/:key/versions/note', async (req, res, next) => { try { const b = req.body || {}; const PW = require('../services/ads/page-watch'); if (b.at) { const ok = await PW.addNote(String(req.params.key || ''), String(b.at), b.note); return res.json({ ok }); } const p = PAGES.find((x) => x.key === String(req.params.key || '')); if (!p) return res.status(404).json({ error: 'Stránka nenalezena' }); const v = await PW.manual(p.key, p.url, b.note); res.json({ ok: true, version: v }); } catch (err) { next(err); } });
// ── AI doporučení úprav stránky: ze struktury stránky, statistik, chování návštěvníků a historie verzí ──
router.post('/pages/:key/recommend', async (req, res, next) => { try {
  const key = String(req.params.key || ''); const p = PAGES.find((x) => x.key === key); if (!p) return res.status(404).json({ error: 'Stránka nenalezena' });
  const days = parseDays(req.query.days, 30); const stats = req.body && req.body.stats ? req.body.stats : null; // klient pošle, co má (ušetří dotazy)
  const PW = require('../services/ads/page-watch'); const versions = (await PW.versions(key)).slice(-8);
  const Anthropic = require('@anthropic-ai/sdk'); const apiKey = process.env.ANTHROPIC_API_KEY; if (!apiKey) return res.status(400).json({ error: 'ANTHROPIC_API_KEY není nastavený' });
  const client = new Anthropic({ apiKey });
  const cur = versions[versions.length - 1]; const sum = cur ? cur.summary : null;
  const prompt = 'Jsi konverzní specialista (CRO) pro prodejní stránky firmy Best Series (prádlomaty – samoobslužné prádelny, prodej strojů a aplikace „Prověření lokality“). Analyzuj záchytnou stránku a navrhni konkrétní úpravy, které zvýší počet leadů / objednávek. Buď věcný, česky, bez obecných frází.\n\nSTRÁNKA: ' + p.name + ' (' + p.url + ')\nSTRUKTURA (aktuální verze): ' + JSON.stringify(sum || {}).slice(0, 6000) + '\n\nSTATISTIKY za ' + (days === 0 ? 'dnes' : days + ' dní') + ' (now vs. prev = předchozí stejně dlouhé období): ' + JSON.stringify(stats ? { now: stats.now, prev: stats.prev, sources: stats.sources, devices: stats.devices, funnel: stats.funnel, packages: stats.packages, goals: stats.goals } : {}).slice(0, 4000) + '\n\nCHOVÁNÍ NÁVŠTĚVNÍKŮ (scroll = kolik relací dosáhlo hloubky; sections = které sekce viděli a kolik sekund na nich; exits = u které sekce odešli; clicks = na co klikali): ' + JSON.stringify(stats && stats.behavior ? Object.assign({}, stats.behavior, { mouse: undefined }) : null).slice(0, 5000) + '\n\nHISTORIE ÚPRAV STRÁNKY (poslední verze, diff = co se změnilo): ' + JSON.stringify(versions.map((v) => ({ at: v.at, diff: v.diff, note: v.note }))).slice(0, 3000) + '\n\nVýstup strukturovaně v Markdownu:\n1. **Kde ztrácíme** – 3–5 konkrétních míst (sekce / krok) s číslem, které to dokládá.\n2. **Doporučené úpravy** – seřazené podle očekávaného dopadu; u každé: co změnit (text/obrázek/tlačítko/pořadí/barva), proč, jak poznáme, že to zabralo (metrika).\n3. **Co otestovat (A/B)** – 2–3 hypotézy.\n4. **Co po poslední úpravě nefunguje / funguje** – pokud historie verzí a čísla před/po něco ukazují.\nPokud data chybí (málo návštěv, žádné sledování), napiš to jednou větou a doporuč, co měřit.';
  const r = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 2200, messages: [{ role: 'user', content: prompt }] });
  const textOut = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  res.json({ ok: true, text: textOut, at: new Date().toISOString() });
} catch (err) { next(err); } });
// ── Segmenty kontaktů (uzel Segment): počty seznamů a leady seznamu; definice přichází v těle (ještě neuložená) ──
router.post('/segments/count', async (req, res, next) => { try { const b = req.body || {}; const nd = { kind: 'db', seg: b.seg || {} }; const c = await require('../services/ads/segments').counts(nd, b.form || null); res.json(c); } catch (err) { next(err); } });
router.post('/segments/leads', async (req, res, next) => { try { const b = req.body || {}; const nd = { kind: 'db', seg: b.seg || {} }; const L = await require('../services/ads/segments').leadsFor(nd, parseInt(b.port, 10) || 0, b.form || null, 500); res.json({ total: L.length, list: L.map((l) => ({ id: l.id, name: l.name, email: l.email, phone: l.phone, status: l.status, source: l.source, created_at: l.created_at, sms: l.schuzka_sms_sent_at || l.ai_specialist_sms_sent_at, email_at: l.schuzka_email_sent_at || l.ai_specialist_email_sent_at, clicked: l.schuzka_opened_at || l.ai_specialist_opened_at })) }); } catch (err) { next(err); } });
router.post('/segments/chain', async (req, res, next) => { try { const b = req.body || {}; const L = await require('../services/ads/segments').leadsForChain(Array.isArray(b.conds) ? b.conds : [], b.form || null, b.base === 'form' ? 'form' : 'all', 50000); res.json({ total: L.length, list: b.list ? L.slice(0, 500).map((l) => ({ id: l.id, name: l.name, email: l.email, phone: l.phone, status: l.status, source: l.source, created_at: l.created_at, sms: l.schuzka_sms_sent_at || l.ai_specialist_sms_sent_at, email_at: l.schuzka_email_sent_at || l.ai_specialist_email_sent_at, clicked: l.schuzka_opened_at || l.ai_specialist_opened_at })) : undefined }); } catch (err) { next(err); } });
router.get('/segments/field-counts', async (req, res, next) => { try {
  const [src, st, ow, ex, tot] = await Promise.all([prisma.compounderLead.groupBy({ by: ['source'], _count: { _all: true } }), prisma.compounderLead.groupBy({ by: ['status'], _count: { _all: true } }), prisma.compounderLead.groupBy({ by: ['owner_person_id', 'external_rep_id'], _count: { _all: true } }), Promise.resolve(null), prisma.compounderLead.count()]);
  const sources = {}, statuses = {}, owners = {}; src.forEach((r) => { sources[r.source || ''] = r._count._all; }); st.forEach((r) => { statuses[r.status || ''] = r._count._all; });
  ow.forEach((r) => { const k = r.owner_person_id ? 'i:' + r.owner_person_id : (r.external_rep_id ? 'e:' + r.external_rep_id : 'none'); owners[k] = (owners[k] || 0) + r._count._all; });
  res.json({ total: tot, sources, statuses, owners }); } catch (err) { next(err); } });
router.get('/segments/fields', async (req, res, next) => { try { const F = require('../services/ads/segments').FIELDS; const people = await prisma.person.findMany({ where: { active: true }, select: { id: true, first_name: true, last_name: true, role: true } }).catch(() => []); const sellers = people.filter((p) => /obchod/i.test(String(p.role || ''))).map((p) => ({ key: 'i:' + p.id, name: ((p.first_name || '') + ' ' + (p.last_name || '')).trim() })); let reps = []; try { reps = (await prisma.externalRep.findMany({ select: { id: true, jmeno: true } })).map((r) => ({ key: 'e:' + r.id, name: r.jmeno })); } catch (e) { reps = []; } res.json({ sources: F.sources.options, statuses: F.statuses.options, owners: sellers.concat(reps).concat([{ key: 'none', name: 'nepřiřazeno' }]) }); } catch (err) { next(err); } });
// ── Kampaň: ruční spuštění SMS / e-mailového uzlu pro leady ze segmentu před ním (pojistky automatu se respektují) ──
router.post('/funnels/:id/nodes/:nodeId/run', async (req, res, next) => { try {
  const f = (await loadFunnels()).find((x) => x.id === String(req.params.id || '')); if (!f) return res.status(404).json({ error: 'Funel nenalezen' });
  const nd = (f.nodes || []).find((x) => x.id === String(req.params.nodeId || '')); if (!nd || (nd.kind !== 'sms' && nd.kind !== 'email')) return res.status(400).json({ error: 'Uzel není SMS / e-mail' });
  const SEG = require('../services/ads/segments'); const ids = new Set(); const force = !!(req.body && req.body.force);
  for (const e of (f.edges || []).filter((x) => x.to === nd.id)) { const A = (f.nodes || []).find((x) => x.id === e.from); if (!A) continue; if (A.kind === 'list') { const byId = {}; (f.nodes || []).forEach((x) => { byId[x.id] = x; }); const conds = []; let cur = A, base = 'all', form = null, g = 0; while (cur && g++ < 12) { if (cur.kind === 'list') conds.unshift(cur.cond || {}); const e2 = (f.edges || []).find((x) => x.to === cur.id); const up = e2 ? byId[e2.from] : null; if (!up) break; if (up.kind === 'db') { if (e2.port > 0 && up.seg && up.seg.lists && up.seg.lists[e2.port - 1]) conds.unshift(up.seg.lists[e2.port - 1].cond || {}); break; } if (up.kind === 'leadform') { base = 'form'; form = up.form; if (e2.port > 0 && up.groups && up.groups[e2.port - 1]) conds.unshift({ ad_ids: up.groups[e2.port - 1].ad_ids || [] }); break; } if (up.kind === 'list' && e2.port > 0 && up.seg && up.seg.lists && up.seg.lists[e2.port - 1]) conds.unshift(up.seg.lists[e2.port - 1].cond || {}); cur = up; } if ((e.port || 0) > 0 && A.seg && A.seg.lists && A.seg.lists[e.port - 1]) conds.push(A.seg.lists[e.port - 1].cond || {}); (await SEG.leadsForChain(conds, form, base)).forEach((l) => ids.add(l.id)); continue; } if (A.kind !== 'db') continue; const fe = (f.edges || []).find((x) => x.to === A.id); const fn = fe ? (f.nodes || []).find((x) => x.id === fe.from && x.kind === 'leadform') : null; (await SEG.leadsFor(A, e.port || 0, fn ? fn.form : null)).forEach((l) => ids.add(l.id)); }
  if (!ids.size) return res.json({ ok: true, total: 0, sent: 0, results: [] });
  const cmp = require('./compounder.routes'); const out = []; let sent = 0; const limit = Math.min(ids.size, 300);
  for (const id of [...ids].slice(0, limit)) { try { const r = await cmp.forceSend(id, nd.kind, force); if (r && r.sent) sent++; out.push({ id, sent: !!(r && r.sent), reason: r && !r.sent ? (r.reason || r.error || '') : '' }); } catch (e2) { out.push({ id, sent: false, reason: e2.message }); } }
  res.json({ ok: true, total: ids.size, sent, results: out.slice(0, 300) });
} catch (err) { next(err); } });
router.get('/pages', (req, res) => res.json(PAGES.map((p) => ({ key: p.key, name: p.name, url: p.url || '', desc: p.desc || '', color: p.color, leadLabel: p.leadLabel || 'leady', convLabel: p.convLabel || 'dokončeno' }))));

// ── Cíle záchytných stránek: AI analýza stránky → co může návštěvník udělat (nákup, kontakt, stažení, odchod…) ──
const GOALS_KEY = 'ads_center.page_goals';
const GOAL_TYPES = ['purchase', 'lead', 'download', 'booking', 'signup', 'browse', 'exit'];
async function loadGoals() { const { getSetting } = require('../services/settings'); const v = await getSetting(GOALS_KEY, { type: 'json', defaultValue: {} }); return v && typeof v === 'object' ? v : {}; }
function cleanGoals(g) {
  const one = (x) => ({ type: GOAL_TYPES.includes(x.type) ? x.type : 'browse', label: String(x.label || '').slice(0, 80), desc: String(x.desc || '').slice(0, 300), primary: !!x.primary, members: Array.isArray(x.members) ? x.members.slice(0, 12).map((m) => String(m).slice(0, 80)) : undefined });
  const goals = (Array.isArray(g && g.goals) ? g.goals : []).slice(0, 12).map(one).filter((x) => x.label);
  // raw_goals = původní výstup analýzy (aby šlo po ručním sloučení/skrytí obnovit nebo znovu upravit)
  const raw = (Array.isArray(g && g.raw_goals) ? g.raw_goals : []).slice(0, 12).map(one).filter((x) => x.label);
  const sf = g && g.stats_from && !isNaN(new Date(g.stats_from)) ? new Date(g.stats_from).toISOString() : null;
  return { goals, raw_goals: raw.length ? raw : undefined, summary: String((g && g.summary) || '').slice(0, 500), analyzed_at: g && g.analyzed_at ? String(g.analyzed_at) : null, source: g && g.source === 'manual' ? 'manual' : 'ai', stats_from: sf }; // stats_from = od kdy počítat statistiky cílů (ignoruje starší/testovací data)
}
// Text stránky pro AI: titulek, viditelný text, tlačítka, odkazy, formuláře a volané /api/ cesty ze skriptů
function pageDigest(html) {
  const apis = Array.from(new Set((html.match(/['"`]\/api\/[A-Za-z0-9_\-\/.:]+/g) || []).map((x) => x.slice(1)))).slice(0, 40);
  const pick = (re, n) => Array.from(html.matchAll(re)).map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, n);
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const buttons = pick(/<button[^>]*>([\s\S]*?)<\/button>/gi, 40);
  const links = pick(/<a\s[^>]*href=["'][^"']*["'][^>]*>([\s\S]*?)<\/a>/gi, 40);
  const inputs = Array.from(html.matchAll(/<(?:input|select|textarea)[^>]*?(?:name|id|placeholder|type)=["']([^"']+)["'][^>]*>/gi)).map((m) => m[1]).slice(0, 40);
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000);
  const inlineJs = (html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || []).join('\n').replace(/<\/?script[^>]*>/gi, '').replace(/\s+/g, ' ').slice(0, 5000);
  return { title: title.trim(), text, buttons, links, inputs, apis, inlineJs };
}
router.get('/pages/:key/digest', async (req, res, next) => { try { const pg = PAGES.find((x) => x.key === String(req.params.key || '')); if (!pg) return res.status(404).json({ error: 'Stránka neexistuje.' });
  const r = await fetch(pg.url, { headers: { 'User-Agent': 'HolyOS-PageAnalyzer/1.0', 'Accept-Language': 'cs' }, signal: AbortSignal.timeout(15000), redirect: 'follow' }); if (!r.ok) return res.status(502).json({ error: 'Stránku se nepodařilo stáhnout (HTTP ' + r.status + ').' });
  const dg = pageDigest((await r.text()).slice(0, 600000)); delete dg.inlineJs; delete dg.apis; res.json(dg); } catch (err) { next(err); } });
router.get('/pages/goals', async (req, res, next) => { try { res.json(await loadGoals()); } catch (err) { next(err); } });
router.put('/pages/:key/goals', express.json({ limit: '20kb' }), async (req, res, next) => {
  try { const key = String(req.params.key || ''); if (!PAGES.some((p) => p.key === key)) return res.status(404).json({ error: 'Stránka neexistuje.' });
    const all = await loadGoals(); const prev = all[key] || {}; const c = cleanGoals(Object.assign({}, req.body || {}, { raw_goals: (req.body && req.body.raw_goals) || prev.raw_goals || prev.goals, summary: (req.body && req.body.summary) || prev.summary, stats_from: req.body && 'stats_from' in req.body ? req.body.stats_from : prev.stats_from })); c.source = 'manual'; c.analyzed_at = prev.analyzed_at || new Date().toISOString(); all[key] = c;
    await require('../services/settings').setSetting(GOALS_KEY, all, { type: 'json', description: 'Centrum reklamy – cíle záchytných stránek', scope: 'marketing', userId: req.user && req.user.id }); res.json(c); } catch (err) { next(err); }
});
router.post('/pages/:key/analyze-goals', async (req, res, next) => {
  try {
    const pg = PAGES.find((p) => p.key === String(req.params.key || '')); if (!pg) return res.status(404).json({ error: 'Stránka neexistuje.' });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: 'Chybí ANTHROPIC_API_KEY na serveru.' });
    let html = '';
    try { const r = await fetch(pg.url, { headers: { 'User-Agent': 'HolyOS-PageAnalyzer/1.0', 'Accept-Language': 'cs' }, signal: AbortSignal.timeout(15000), redirect: 'follow' }); if (!r.ok) throw new Error('HTTP ' + r.status); html = (await r.text()).slice(0, 600000); }
    catch (e) { return res.status(502).json({ error: 'Stránku se nepodařilo stáhnout: ' + e.message }); }
    const dg = pageDigest(html);
    const Anthropic = require('@anthropic-ai/sdk'); const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = 'Analyzuješ veřejnou záchytnou (landing) stránku pro marketingový funel. Urči, jaké CÍLE (akce) tam může návštěvník udělat: jen přijde a odejde, nákup (různé balíčky/varianty), zanechání kontaktu/poptávka/rezervace, stažení obsahu, registrace atd. Vycházej jen z podkladů, nic si nevymýšlej. U každého cíle dej typ, krátký název (česky), popis co přesně se stane a zda je to hlavní cíl.\n\n' +
      'Stránka: ' + pg.name + ' (' + pg.url + ')\nPopis z interní evidence: ' + (pg.desc || '') + '\n\nPODKLADY:\n' + JSON.stringify(dg).slice(0, 18000) +
      '\n\nOdpověz POUZE JSON: {"summary":"1–2 věty o účelu stránky","goals":[{"type":"purchase|lead|download|booking|signup|browse|exit","label":"…","desc":"…","primary":true|false}]}. Vždy zahrň i cíl typu "exit" (návštěvník jen prohlédne a odejde). Max 8 cílů.';
    const resp = await client.messages.create({ model: process.env.ADS_GOALS_MODEL || 'claude-sonnet-4-6', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] });
    const txt = (resp.content || []).map((b) => b.text || '').join('');
    const m = txt.match(/\{[\s\S]*\}/); if (!m) return res.status(502).json({ error: 'AI nevrátila použitelnou odpověď.' });
    let parsed; try { parsed = JSON.parse(m[0]); } catch (e) { return res.status(502).json({ error: 'AI vrátila neplatný JSON.' }); }
    const c = cleanGoals(Object.assign({}, parsed, { raw_goals: parsed.goals, stats_from: (all[pg.key] || {}).stats_from })); c.source = 'ai'; c.analyzed_at = new Date().toISOString();
    const all = await loadGoals(); all[pg.key] = c; await require('../services/settings').setSetting(GOALS_KEY, all, { type: 'json', description: 'Centrum reklamy – cíle záchytných stránek', scope: 'marketing', userId: req.user && req.user.id });
    res.json(c);
  } catch (err) { next(err); }
});

// ── Ziskovost marketingu: útrata po reklamách (Meta) → leady → kvalifikované → prodeje → zisk; kvalita leadů; demografie; časy ──
const ECON_KEY = 'ads_center.economics';
const ECON_DEF = { margin_pct: 90, stripe_fee_pct: 1.5, stripe_fee_fixed: 0, sms_cost: 0.9, email_cost: 0.05, machine_price: 0, machine_margin_pct: 0, call_cost_per_lead: 0 };
async function loadEcon() { const { getSetting } = require('../services/settings'); const v = (await getSetting(ECON_KEY, { type: 'json', defaultValue: {} })) || {}; return Object.assign({}, ECON_DEF, v); }
router.get('/economics', async (req, res, next) => { try { res.json(await loadEcon()); } catch (err) { next(err); } });
router.put('/economics', express.json({ limit: '10kb' }), async (req, res, next) => {
  try { const b = req.body || {}; const out = {}; Object.keys(ECON_DEF).forEach((k) => { const v = Number(b[k]); out[k] = isFinite(v) && v >= 0 ? v : ECON_DEF[k]; });
    await require('../services/settings').setSetting(ECON_KEY, out, { type: 'json', description: 'Centrum reklamy – ekonomika (marže, poplatky, ceny zpráv)', scope: 'marketing', userId: req.user && req.user.id }); res.json(out); } catch (err) { next(err); }
});
const QUAL = new Set(['qualified', 'won', 'prodano', 'converted']), WON = new Set(['won', 'prodano', 'converted']);
const firstSent = (l) => { const t = [l.ai_specialist_sms_sent_at, l.schuzka_sms_sent_at, l.ai_specialist_email_sent_at, l.schuzka_email_sent_at].filter(Boolean).map((x) => new Date(x).getTime()); return t.length ? Math.min(...t) : null; };
const medianOf = (a) => { const x = a.filter((v) => isFinite(v)).sort((p, q) => p - q); return x.length ? x[Math.floor(x.length / 2)] : null; };
function metaRange(days) { const since = sinceDate(days); const until = since.until || new Date(); return { since, until, tr: JSON.stringify({ since: dayKey(since), until: dayKey(new Date(until.getTime() - 1)) }) }; }
const actOf = (row, t) => { const a = (row.actions || []).find((x) => x.action_type === t); return a ? Number(a.value) : 0; };
router.get('/profit', async (req, res, next) => {
  try {
    const days = parseDays(req.query.days, 30); const { since, until, tr } = metaRange(days); const econ = await loadEcon(); const c = await metaCfg(req);
    // 1) Meta: útrata a výkon po reklamách
    let ads = [], metaErr = null, currency = 'CZK';
    if (c.token && c.account) { try { const j = await graph('act_' + c.account + '/insights', { level: 'ad', fields: 'ad_id,ad_name,adset_name,campaign_id,campaign_name,spend,impressions,reach,clicks,inline_link_clicks,ctr,cpm,frequency,actions,account_currency', time_range: tr, limit: 500 }, c.token);
      ads = (j.data || []).map((r) => { currency = r.account_currency || currency; return { ad_id: String(r.ad_id), ad_name: r.ad_name, adset: r.adset_name, campaign_id: String(r.campaign_id), campaign: r.campaign_name, spend: Number(r.spend || 0), impressions: Number(r.impressions || 0), reach: Number(r.reach || 0), clicks: Number(r.inline_link_clicks || actOf(r, 'link_click') || r.clicks || 0), ctr: r.ctr != null ? Number(r.ctr) : null, cpm: r.cpm != null ? Number(r.cpm) : null, frequency: r.frequency != null ? Number(r.frequency) : null, meta_leads: actOf(r, 'lead') || actOf(r, 'onsite_conversion.lead_grouped') }; }); } catch (e) { metaErr = e.message; } } else metaErr = 'Meta není napojená';
    // 2) leady z HolyOS v období
    const leads = await prisma.compounderLead.findMany({ where: { created_at: rng(since) }, select: { id: true, status: true, source: true, created_at: true, owner_person_id: true, external_rep_id: true, meta_ad_id: true, ai_specialist_sms_sent_at: true, schuzka_sms_sent_at: true, ai_specialist_email_sent_at: true, schuzka_email_sent_at: true } });
    const adById = {}; ads.forEach((a) => { a.leads = 0; a.qualified = 0; a.won = 0; adById[a.ad_id] = a; });
    const mk = () => ({ leads: 0, contacted: 0, qualified: 0, won: 0, nedovolano: 0, nezajem: 0, ttf: [] });
    const bySource = {}, byOwner = {}; let smsN = 0, emailN = 0; const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
    leads.forEach((l) => { const q = QUAL.has(l.status), w = WON.has(l.status); const a = l.meta_ad_id && adById[String(l.meta_ad_id)]; if (a) { a.leads++; if (q) a.qualified++; if (w) a.won++; }
      const fs = firstSent(l); if (l.ai_specialist_sms_sent_at || l.schuzka_sms_sent_at) smsN++; if (l.ai_specialist_email_sent_at || l.schuzka_email_sent_at) emailN++;
      const own = l.owner_person_id ? 'i:' + l.owner_person_id : (l.external_rep_id ? 'e:' + l.external_rep_id : 'none');
      [[bySource, l.source || '(prázdné)'], [byOwner, own]].forEach(([o, k]) => { const s = o[k] = o[k] || mk(); s.leads++; if (fs || (l.status && l.status !== 'new')) s.contacted++; if (q) s.qualified++; if (w) s.won++; if (l.status === 'nedovolano') s.nedovolano++; if (l.status === 'nezajem') s.nezajem++; if (fs) s.ttf.push((fs - new Date(l.created_at).getTime()) / 3600000); });
      const d = new Date(l.created_at); const cz = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Prague' })); heat[(cz.getDay() + 6) % 7][cz.getHours()]++; });
    const pids = Object.keys(byOwner).filter((k) => k.startsWith('i:')).map((k) => Number(k.slice(2))); const persons = pids.length ? await prisma.person.findMany({ where: { id: { in: pids } }, select: { id: true, first_name: true, last_name: true } }).catch(() => []) : [];
    const ownerName = (k) => { if (k === 'none') return 'nepřiřazeno'; if (k.startsWith('i:')) { const p = persons.find((x) => x.id === Number(k.slice(2))); return p ? ((p.first_name || '') + ' ' + (p.last_name || '')).trim() : k; } return 'externí ' + k.slice(2); };
    const fin = (o, nameFn) => Object.keys(o).map((k) => { const s = o[k]; return { name: nameFn ? nameFn(k) : k, leads: s.leads, contacted: s.contacted, qualified: s.qualified, won: s.won, nedovolano: s.nedovolano, nezajem: s.nezajem, median_hours_to_contact: s.ttf.length ? Math.round(medianOf(s.ttf) * 10) / 10 : null }; }).sort((a, b) => b.leads - a.leads);
    // 3) BS2: online objednávky podle UTM + chování (relace z Facebooku)
    let bs2 = null, fbSessions = null; try { bs2 = await bs2Stats(Math.max(1, days + 1), since.until || days === 0 ? since : null, '/location'); } catch (e) { bs2 = null; }
    const attr = (bs2 && bs2.ordersByAttr) || []; const isAdSrc = (s) => /^(fb|facebook|meta|ig|instagram|google|gads|adwords)/i.test(String(s || ''));
    const onlineAll = { paid: attr.reduce((t, x) => t + x.paid, 0), revenue: attr.reduce((t, x) => t + Number(x.revenue || 0), 0) };
    const onlineAds = attr.filter((x) => isAdSrc(x.source)).reduce((t, x) => ({ paid: t.paid + x.paid, revenue: t.revenue + Number(x.revenue || 0) }), { paid: 0, revenue: 0 });
    attr.forEach((x) => { const a = (x.ad_id && adById[x.ad_id]) || ads.find((y) => x.content && y.ad_name === x.content); if (a) { a.online_paid = (a.online_paid || 0) + x.paid; a.online_revenue = (a.online_revenue || 0) + Number(x.revenue || 0); } });
    if (bs2 && bs2.behavior && bs2.behavior.campaigns) fbSessions = bs2.behavior.campaigns.filter((x) => /facebook|^fb|instagram|fbclid/i.test(x.name)).reduce((t, x) => t + x.sessions, 0);
    // 4) ekonomika
    const spend = ads.reduce((t, a) => t + a.spend, 0), impressions = ads.reduce((t, a) => t + a.impressions, 0), clicks = ads.reduce((t, a) => t + a.clicks, 0);
    const qualified = leads.filter((l) => QUAL.has(l.status)).length, won = leads.filter((l) => WON.has(l.status)).length;
    const fee = (rev, n) => rev * econ.stripe_fee_pct / 100 + n * econ.stripe_fee_fixed;
    const profitOf = (spendX, onlineRev, onlineN, wonN, leadsN) => Math.round(onlineRev * econ.margin_pct / 100 - fee(onlineRev, onlineN) + wonN * econ.machine_price * econ.machine_margin_pct / 100 - spendX - leadsN * econ.call_cost_per_lead);
    ads.forEach((a) => { a.cpl = a.leads > 0 ? a.spend / a.leads : null; a.cpql = a.qualified > 0 ? a.spend / a.qualified : null; a.revenue = (a.online_revenue || 0) + a.won * econ.machine_price; a.profit = profitOf(a.spend, a.online_revenue || 0, a.online_paid || 0, a.won, a.leads); a.roas = a.spend > 0 ? a.revenue / a.spend : null; });
    const msgCost = smsN * econ.sms_cost + emailN * econ.email_cost;
    const revenue = onlineAds.revenue + won * econ.machine_price;
    const profit = profitOf(spend, onlineAds.revenue, onlineAds.paid, won, leads.length) - Math.round(msgCost);
    const orders = onlineAds.paid + won;
    res.json({ period: { days, since: since.toISOString(), until: until.toISOString() }, currency, econ, meta_error: metaErr,
      kpi: { spend, impressions, clicks, ctr: impressions ? clicks / impressions * 100 : null, cpm: impressions ? spend / impressions * 1000 : null, leads: leads.length, cpl: leads.length ? spend / leads.length : null, qualified, cpql: qualified ? spend / qualified : null, won, online_paid_ads: onlineAds.paid, online_revenue_ads: onlineAds.revenue, online_paid_all: onlineAll.paid, online_revenue_all: onlineAll.revenue, revenue, orders, cac: orders ? spend / orders : null, roas: spend ? revenue / spend : null, messages_cost: Math.round(msgCost), sms: smsN, emails: emailN, profit, fb_link_clicks: clicks, fb_sessions: fbSessions },
      ads: ads.sort((a, b) => b.spend - a.spend), bySource: fin(bySource), byOwner: fin(byOwner, ownerName), heat, orderHours: (bs2 && bs2.orderHours) || null, attr });
  } catch (err) { next(err); }
});
// Demografie a umístění z Mety: ?by=age_gender | region | placement | device
router.get('/profit/breakdown', async (req, res, next) => {
  try { const days = parseDays(req.query.days, 30); const { tr } = metaRange(days); const c = await metaCfg(req); if (!c.token || !c.account) return res.status(400).json({ error: 'Meta není napojená' });
    const by = String(req.query.by || 'age_gender'); const bd = { age_gender: 'age,gender', region: 'region', placement: 'publisher_platform,platform_position', device: 'impression_device' }[by]; if (!bd) return res.status(400).json({ error: 'Neznámý rozpad' });
    const j = await graph('act_' + c.account + '/insights', { level: 'account', breakdowns: bd, fields: 'spend,impressions,inline_link_clicks,clicks,ctr,cpm,actions', time_range: tr, limit: 300 }, c.token);
    const rows = (j.data || []).map((r) => { const leads = actOf(r, 'lead') || actOf(r, 'onsite_conversion.lead_grouped'); const spend = Number(r.spend || 0); return { label: bd.split(',').map((k) => r[k]).filter(Boolean).join(' · ') || '—', spend, impressions: Number(r.impressions || 0), clicks: Number(r.inline_link_clicks || r.clicks || 0), ctr: r.ctr != null ? Number(r.ctr) : null, cpm: r.cpm != null ? Number(r.cpm) : null, leads, cpl: leads ? spend / leads : null }; }).sort((a, b) => b.spend - a.spend);
    res.json({ by, rows }); } catch (err) { next(err); }
});

// ── Meta (Facebook) Ads: napojení na reklamní účet, seznam kampaní, statistiky a nastavení (cíl = URL / lead formulář) ──
// Přístupový token s právem ads_read (System User token v Business Manageru) + ID reklamního účtu se ukládají v AppSetting
// (nebo env META_ADS_ACCESS_TOKEN / META_AD_ACCOUNT_ID). Token se nikdy nevrací do prohlížeče.
const META_KEY = 'ads_center.meta';
const GRAPH = 'https://graph.facebook.com/v19.0/';
async function metaCfg(req) { const { getSetting } = require('../services/settings'); const v = (await getSetting(META_KEY, { type: 'json', defaultValue: {} })) || {}; const over = req && req.query && req.query.account ? String(req.query.account).replace(/^act_/, '').replace(/[^0-9]/g, '') : ''; return { token: v.token || process.env.META_ADS_ACCESS_TOKEN || v.user_token || '', account: over || String(v.account || process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, ''), source: v.token ? 'nastavení' : (process.env.META_ADS_ACCESS_TOKEN ? 'env' : '') }; }
async function graph(path, params, token) { const u = new URL(GRAPH + path); Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, v)); u.searchParams.set('access_token', token); const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); const j = await r.json().catch(() => ({})); if (!r.ok || j.error) throw new Error((j.error && j.error.message) || ('Meta ' + r.status)); return j; }
router.get('/meta/config', async (req, res, next) => { try { const c = await metaCfg(); res.json({ connected: !!(c.token && c.account), account: c.account, source: c.source || (c.token ? 'účet' : ''), hasToken: !!c.token }); } catch (err) { next(err); } });
router.put('/meta/config', express.json({ limit: '20kb' }), async (req, res, next) => {
  try { const { getSetting, setSetting } = require('../services/settings'); const cur = (await getSetting(META_KEY, { type: 'json', defaultValue: {} })) || {}; const b = req.body || {};
    const v = Object.assign({}, cur, { token: b.token ? String(b.token).trim() : (b.clear ? '' : cur.token || ''), account: String(b.account != null ? b.account : cur.account || '').trim().replace(/^act_/, '') }); // ostatní klíče (OAuth účet, page tokeny) zachovat
    await setSetting(META_KEY, v, { type: 'json', description: 'Centrum reklamy – Meta Ads napojení (token + reklamní účet)', scope: 'marketing', userId: req.user && req.user.id });
    res.json({ ok: true, connected: !!(v.token && v.account) }); } catch (err) { next(err); } });
router.get('/meta/test', async (req, res, next) => { try { const c = await metaCfg(); if (!c.token) return res.status(400).json({ error: 'Chybí token' }); const me = await graph('me', { fields: 'id,name' }, c.token); let acc = null; if (c.account) acc = await graph('act_' + c.account, { fields: 'id,name,account_status,currency,amount_spent' }, c.token); res.json({ me, account: acc }); } catch (err) { res.status(400).json({ error: err.message }); } });
router.get('/meta/accounts', async (req, res, next) => { try { const c = await metaCfg(); if (!c.token) return res.status(400).json({ error: 'Chybí token' }); const j = await graph('me/adaccounts', { fields: 'id,name,account_status,currency', limit: 100 }, c.token); res.json((j.data || []).map((a) => ({ id: String(a.id).replace(/^act_/, ''), name: a.name, status: a.account_status, currency: a.currency }))); } catch (err) { res.status(400).json({ error: err.message }); } });
// Kampaně se statistikami za období
router.get('/meta/campaigns', async (req, res, next) => {
  try { const c = await metaCfg(req); if (!c.token) return res.status(400).json({ error: 'Meta Ads nejsou napojené – nastav token v Centru reklamy → Nastavení.' }); if (!c.account) return res.status(400).json({ error: 'Vyber reklamní účet.' });
    const days = parseDays(req.query.days, 30);
    const j = await graph('act_' + c.account + '/campaigns', { fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,insights.date_preset(' + (parseShift(req.query.shift) === 1 && days <= 1 ? 'yesterday' : days === 0 ? 'today' : 'last_' + (days <= 7 ? '7d' : days <= 30 ? '30d' : '90d')) + '){impressions,reach,clicks,spend,cpc,cpm,ctr,actions,cost_per_action_type}', limit: 100 }, c.token);
    const out = (j.data || []).map((k) => { const ins = (k.insights && k.insights.data && k.insights.data[0]) || {}; const act = (t) => { const a = (ins.actions || []).find((x) => x.action_type === t); return a ? Number(a.value) : 0; };
      return { id: k.id, name: k.name, status: k.effective_status || k.status, objective: k.objective, daily_budget: k.daily_budget ? Number(k.daily_budget) / 100 : null, lifetime_budget: k.lifetime_budget ? Number(k.lifetime_budget) / 100 : null, start: k.start_time, stop: k.stop_time,
        impressions: Number(ins.impressions || 0), reach: Number(ins.reach || 0), clicks: Number(ins.clicks || 0), spend: Number(ins.spend || 0), cpc: ins.cpc != null ? Number(ins.cpc) : null, cpm: ins.cpm != null ? Number(ins.cpm) : null, ctr: ins.ctr != null ? Number(ins.ctr) : null, link_clicks: act('link_click'), leads: act('lead') || act('onsite_conversion.lead_grouped'), landing_views: act('landing_page_view') }; });
    res.json({ days, campaigns: out });
  } catch (err) { res.status(400).json({ error: err.message }); } });
// Detail kampaně: sady + reklamy s koncovým bodem (odkaz na stránku / lead formulář) a statistikami
router.get('/meta/campaigns/:id', async (req, res, next) => {
  try { const c = await metaCfg(req); if (!c.token || !c.account) return res.status(400).json({ error: 'Meta Ads nejsou napojené.' });
    const days = parseDays(req.query.days, 30); const preset = parseShift(req.query.shift) === 1 && days <= 1 ? 'yesterday' : days === 0 ? 'today' : 'last_' + (days <= 7 ? '7d' : days <= 30 ? '30d' : '90d');
    const id = String(req.params.id).replace(/[^0-9]/g, '');
    const camp = await graph(id, { fields: 'id,name,status,effective_status,objective,buying_type,daily_budget,lifetime_budget,start_time,stop_time,special_ad_categories' }, c.token);
    const sets = await graph(id + '/adsets', { fields: 'id,name,status,effective_status,optimization_goal,billing_event,daily_budget,lifetime_budget,targeting{geo_locations,age_min,age_max,genders,interests},promoted_object,destination_type', limit: 50 }, c.token);
    const ads = await graph(id + '/ads', { fields: 'id,name,status,effective_status,adset_id,creative{id,name,object_story_spec,asset_feed_spec,call_to_action_type,link_url,object_url,effective_object_story_id},insights.date_preset(' + preset + '){impressions,reach,clicks,inline_link_clicks,spend,ctr,cpc,actions}', limit: 100 }, c.token);
    const endpoint = (cr) => { if (!cr) return { type: 'unknown' }; const spec = cr.object_story_spec || {}; const ld = spec.link_data || {}; const vd = spec.video_data || {}; const cta = (ld.call_to_action || vd.call_to_action || {}); const afs = cr.asset_feed_spec || {}; const afsCta = (afs.call_to_actions || []).map((x) => x && x.value && (x.value.lead_gen_form_id || x.value.leadgen_form_id)).find(Boolean); const lead = (cta.value && (cta.value.lead_gen_form_id || cta.value.leadgen_form_id)) || afsCta || null; if (lead) return { type: 'lead_form', form_id: lead, cta: cta.type || cr.call_to_action_type || null }; const link = ld.link || (vd.call_to_action && vd.call_to_action.value && vd.call_to_action.value.link) || cr.link_url || cr.object_url || (cr.asset_feed_spec && cr.asset_feed_spec.link_urls && cr.asset_feed_spec.link_urls[0] && cr.asset_feed_spec.link_urls[0].website_url) || null; if (link && /^https?:\/\/fb\.me\/?$/i.test(String(link).trim())) return { type: 'lead_form', form_id: null, cta: cta.type || cr.call_to_action_type || null }; if (link) return { type: 'website', url: link, cta: cta.type || cr.call_to_action_type || null }; return { type: 'other', cta: cta.type || cr.call_to_action_type || null }; };
    const leadSets = new Set((sets.data || []).filter((s0) => s0.optimization_goal === 'LEAD_GENERATION' || s0.destination_type === 'ON_AD').map((s0) => s0.id));
    const endpointOf = (a) => { const ep = endpoint(a.creative); if (ep.type !== 'lead_form' && leadSets.has(String(a.adset_id))) return { type: 'lead_form', form_id: ep.form_id || null, cta: ep.cta || null }; return ep; };
    const postCache = {};
    const resolveForm = async (a, ep) => { if (ep.type !== 'lead_form' || ep.form_id) return ep; const pid = a.creative && a.creative.effective_object_story_id; if (!pid) return ep; if (!(pid in postCache)) { try { const po = await graph(pid, { fields: 'call_to_action' }, c.token); postCache[pid] = (po.call_to_action && po.call_to_action.value && (po.call_to_action.value.lead_gen_form_id || po.call_to_action.value.leadgen_form_id)) || null; } catch (_) { postCache[pid] = null; } } if (postCache[pid]) ep.form_id = postCache[pid]; return ep; };
    for (const a of ads.data || []) a._ep = await resolveForm(a, endpointOf(a));
    // Název/otázky formuláře: nejdřív page tokeny z připojeného FB účtu (formulář patří stránce), pak System User token, nakonec pracovní sada.
    const formNames = {}; let wsNames = {}; try { wsNames = ((await require('../services/ads/meta-leads-sync').cfg()).form_names) || {}; } catch (_) { /* bez pracovní sady */ }
    let pageTokens = []; try { const { getSetting } = require('../services/settings'); const m = (await getSetting('ads_center.meta', { type: 'json', defaultValue: {} })) || {}; pageTokens = (m.pages || []).map((p) => p.access_token).filter(Boolean); } catch (_) { /* bez OAuth */ }
    for (const a of ads.data || []) { const ep = a._ep; if (ep.type === 'lead_form' && ep.form_id && !formNames[ep.form_id]) { let got = null; for (const tk of [...pageTokens, c.token]) { try { const f = await graph(ep.form_id, { fields: 'id,name,status,questions' }, tk); got = { name: f.name, status: f.status, questions: (f.questions || []).map((q) => q.label || q.type) }; break; } catch (e) { /* další token */ } } formNames[ep.form_id] = got || { name: (wsNames[ep.form_id] && wsNames[ep.form_id].name) || ('formulář ' + ep.form_id) }; } }
    // (bez ID formuláře zůstane jen typ „rychlý formulář“ – ID Meta nevrací u některých kreativ ze stávajících příspěvků)
    res.json({ campaign: camp, adsets: (sets.data || []).map((s0) => ({ id: s0.id, name: s0.name, status: s0.effective_status || s0.status, optimization_goal: s0.optimization_goal, destination_type: s0.destination_type, daily_budget: s0.daily_budget ? Number(s0.daily_budget) / 100 : null, targeting: s0.targeting ? { countries: (s0.targeting.geo_locations || {}).countries, cities: ((s0.targeting.geo_locations || {}).cities || []).map((x) => x.name), age: [s0.targeting.age_min, s0.targeting.age_max], interests: (s0.targeting.interests || []).map((x) => x.name) } : null })),
      ads: (ads.data || []).map((a) => { const ins = (a.insights && a.insights.data && a.insights.data[0]) || {}; const ep = a._ep; if (ep.type === 'lead_form' && ep.form_id) ep.form = formNames[ep.form_id]; return { id: a.id, name: a.name, status: a.effective_status || a.status, adset_id: a.adset_id, endpoint: ep, impressions: Number(ins.impressions || 0), clicks: Number(ins.clicks || 0), link_clicks: Number(ins.inline_link_clicks || 0), spend: Number(ins.spend || 0), ctr: ins.ctr != null ? Number(ins.ctr) : null, leads: ((ins.actions || []).find((x) => x.action_type === 'lead' || x.action_type === 'onsite_conversion.lead_grouped') || {}).value || 0 }; }) });
  } catch (err) { res.status(400).json({ error: err.message }); } });

// ── Leady z rychlého formuláře: seznam kontaktů, které přes formulář přišly do HolyOS (CompounderLead.meta_form_id,
//    plní je webhook FB Lead Ads). ?days= období (0 = celá historie), ?campaign= záložní párování podle názvu kampaně.
const CMP_STATUS = { new: 'Nový', nedovolano: 'Nedovoláno', volat_pristi: 'Volat příště', contacted: 'Kontaktován', access_sent: 'Odeslán přístup', odeslan_specialista: 'Odeslán odkaz na specialistu', psal_chatovi: 'Psal s chatem', schuzka: 'Domluvena schůzka', schuzka_online: 'Domluvena schůzka online', qualified: 'Kvalifikován', dosledovani: 'Dosledování', slibeny_krok: 'Slíbený krok', smlouva_odeslat: 'Odeslat dokumentaci', smlouva_odeslana: 'Dokumentace odeslána', poptavka_financovani: 'Poptávka financování', odeslana_schuzka: 'Odeslána schůzka', prodano: 'Prodáno', converted: 'Převeden', nezajem: 'Nemá zájem', nelze_pouzit: 'Nelze použít', rejected: 'Zamítnut' };
// Rychlý počet leadů formuláře v HolyOS za období (pro uzel na plátně): celkem + z toho napřímo + dnes.
router.get('/meta/forms/:formId/count', async (req, res, next) => {
  try { const formId = String(req.params.formId || '').replace(/[^0-9]/g, ''); const days = parseDays(req.query.days, 30); const ads = String(req.query.ads || '').split(',').map((x) => x.replace(/[^0-9]/g, '')).filter(Boolean);
    const or = []; if (ads.length && req.query.scope !== 'form') or.push({ meta_ad_id: { in: ads } }); if (formId) or.push({ meta_form_id: formId }); if (!or.length) return res.json({ total: 0, direct: 0, today: 0 });
    const since = sinceDate(days); const where = { OR: or, created_at: rng(since) }; const day0 = new Date(); day0.setHours(0, 0, 0, 0);
    const [total, today, rows] = await Promise.all([prisma.compounderLead.count({ where }), prisma.compounderLead.count({ where: { OR: or, created_at: { gte: day0 } } }), prisma.compounderLead.findMany({ where, select: { activity_log: true } })]);
    const direct = rows.filter((r) => /napřímo/.test(String(r.activity_log || '').split('\n')[0])).length;
    res.json({ total, direct, today, days }); } catch (err) { next(err); } });
// Rozdělení leadů formuláře mezi obchodníky za období (pro uzel Rozdělení): counts['i:<person_id>'|'e:<rep_id>'] = počet.
router.get('/meta/forms/:formId/split-stats', async (req, res, next) => {
  try { const formId = String(req.params.formId || '').replace(/[^0-9]/g, ''); const days = parseDays(req.query.days, 30); const ads = String(req.query.ads || '').split(',').map((x) => x.replace(/[^0-9]/g, '')).filter(Boolean);
    const or = []; if (ads.length && req.query.scope !== 'form') or.push({ meta_ad_id: { in: ads } }); if (formId) or.push({ meta_form_id: formId }); if (!or.length) return res.json({ counts: {}, unassigned: 0 });
    const rows = await prisma.compounderLead.findMany({ where: { OR: or, created_at: rng(sinceDate(days)) }, select: { owner_person_id: true, external_rep_id: true } });
    const counts = {}; let unassigned = 0; rows.forEach((r) => { const k = r.owner_person_id ? 'i:' + r.owner_person_id : (r.external_rep_id ? 'e:' + r.external_rep_id : null); if (!k) { unassigned++; return; } counts[k] = (counts[k] || 0) + 1; });
    res.json({ counts, unassigned, total: rows.length, days }); } catch (err) { next(err); } });
// Kdo je na řadě: stejná logika jako přiřazování (_fbResolveOwner) – cyklus podle počtů, pozice = leady od split_since.
router.get('/meta/forms/:formId/next', async (req, res, next) => {
  try { const formId = String(req.params.formId || '').replace(/[^0-9]/g, ''); const cmp = require('./compounder.routes'); const forms = await cmp._fbLoadForms(); const cfg = forms.find((f) => String(f.form_id) === formId); if (!cfg) return res.json({ mode: 'none' });
    const cyc = (cfg.split || []).filter((s) => s && (s.owner_person_id || s.external_rep_id) && Number(s.count) > 0);
    if (cyc.length) { const seq = []; cyc.forEach((s) => { const k = s.owner_person_id ? 'i:' + s.owner_person_id : 'e:' + s.external_rep_id; const n = Math.min(999, Math.max(0, Math.round(Number(s.count) || 0))); for (let i = 0; i < n; i++) seq.push(k); });
      const where = { meta_form_id: formId }; if (cfg.split_since) where.created_at = { gte: new Date(cfg.split_since) }; const pos = await prisma.compounderLead.count({ where }); const idx = seq.length ? pos % seq.length : 0; const cur = seq[idx]; let remain = 0; for (let i = idx; i < seq.length && seq[i] === cur; i++) remain++;
      const order = []; for (let i = 0; i < seq.length; i++) order.push(seq[(idx + i) % seq.length]);
      return res.json({ mode: 'cycle', next: cur, remaining: remain, position: idx + 1, cycle_len: seq.length, since: cfg.split_since || null, assigned_since: pos, order: order.slice(0, 12) }); }
    const split = (cfg.split || []).filter((s) => s && (s.owner_person_id || s.external_rep_id) && Number(s.percent) > 0);
    if (split.length > 1) return res.json({ mode: 'percent' });
    const k = cfg.owner_person_id ? 'i:' + cfg.owner_person_id : (cfg.external_rep_id ? 'e:' + cfg.external_rep_id : null); return res.json({ mode: k ? 'single' : 'none', next: k });
  } catch (err) { next(err); } });
const AD_NAME_CACHE = {};
async function adNamesOf(ids) {
  const out = {}; const need = []; const now = Date.now(); ids.forEach((id) => { const c = AD_NAME_CACHE[id]; if (c && now - c.t < 600000) out[id] = c.v; else need.push(id); });
  if (need.length) { try { const c = await metaCfg(); if (c.token) { const j = await graph('', { ids: need.join(','), fields: 'name,campaign{name}' }, c.token); need.forEach((id) => { const r = j[id]; if (r) { const v = { ad: r.name || null, campaign: r.campaign && r.campaign.name || null }; AD_NAME_CACHE[id] = { t: now, v }; out[id] = v; } }); } } catch (e) { /* bez názvů */ } }
  return out;
}
// Počty leadů po reklamách (a názvy reklam) pro ouško formuláře: ?days & ?ads=id,id
router.get('/meta/forms/:formId/ad-counts', async (req, res, next) => {
  try { const formId = String(req.params.formId || '').replace(/[^0-9]/g, ''); const days = parseDays(req.query.days, 30); const since = sinceDate(days);
    const ads = String(req.query.ads || '').split(',').map((x) => x.replace(/[^0-9]/g, '')).filter(Boolean).slice(0, 200);
    const where = { created_at: rng(since), OR: (formId ? [{ meta_form_id: formId }] : []).concat(ads.length ? [{ meta_ad_id: { in: ads } }] : []) }; if (!where.OR.length) return res.json({ counts: {}, names: {} });
    const g = await prisma.compounderLead.groupBy({ by: ['meta_ad_id'], where, _count: { _all: true } }); const counts = {}; g.forEach((r) => { if (r.meta_ad_id) counts[r.meta_ad_id] = r._count._all; });
    const names = await adNamesOf([...new Set(ads.concat(Object.keys(counts)))].slice(0, 80)); res.json({ counts, names }); } catch (err) { next(err); } });
router.get('/meta/forms/:formId/leads', async (req, res, next) => {
  try {
    const formId = String(req.params.formId || '').replace(/[^0-9]/g, ''); const days = Math.max(0, Math.min(3650, parseInt(req.query.days, 10) || 0)); const campaign = String(req.query.campaign || '').trim();
    const ads = String(req.query.ads || '').split(',').map((x) => x.replace(/[^0-9]/g, '')).filter(Boolean).slice(0, 200);
    // Primárně podle reklam kampaně (meta_ad_id) – formulář bývá sdílený víc kampaněmi; ?scope=form → celý formulář.
    const or = []; if (ads.length && req.query.scope !== 'form') or.push({ meta_ad_id: { in: ads } }); else { if (formId) or.push({ meta_form_id: formId }); if (campaign) or.push({ campaign }); } if (!or.length) return res.json({ total: 0, in_period: 0, leads: [], by_status: {} });
    const base = { OR: or }; const where = days ? Object.assign({}, base, { created_at: { gte: new Date(Date.now() - days * 86400000) } }) : base;
    const [total, rows] = await Promise.all([prisma.compounderLead.count({ where: base }), prisma.compounderLead.findMany({ where, orderBy: { created_at: 'desc' }, take: 2000, select: { id: true, name: true, first_name: true, last_name: true, company: true, city: true, email: true, phone: true, status: true, is_hot: true, is_test: true, source: true, campaign: true, created_at: true, last_called_at: true, owner_person_id: true, external_rep_id: true, ai_specialist_opened_at: true, schuzka_opened_at: true, meta_ad_id: true, meta_lead_id: true, meta_form_id: true, activity_log: true, notes: true } })]);
    const pids = [...new Set(rows.map((r) => r.owner_person_id).filter(Boolean))]; const people = pids.length ? await prisma.person.findMany({ where: { id: { in: pids } }, select: { id: true, first_name: true, last_name: true } }) : []; const pname = {}; people.forEach((p) => { pname[p.id] = [p.first_name, p.last_name].filter(Boolean).join(' '); });
    let reps = {}; try { const { getSetting } = require('../services/settings'); const r = await getSetting('external.sales_reps', { type: 'json', defaultValue: [] }); (Array.isArray(r) ? r : []).forEach((x) => { reps[x.id] = x.name || x.company || ('externí #' + x.id); }); } catch (_) { /* bez externích */ }
    const by = {}; rows.forEach((r) => { const k = r.status || 'new'; by[k] = (by[k] || 0) + 1; });
    // názvy reklam a kampaní k meta_ad_id (jedním dotazem na Metu, s krátkou pamětí)
    const adNames = await adNamesOf([...new Set(rows.map((r) => r.meta_ad_id).filter(Boolean))].slice(0, 50));
    res.json({ total, in_period: rows.length, scope: (ads.length && req.query.scope !== 'form') ? 'ads' : 'form', by_status: by, status_labels: CMP_STATUS, leads: rows.map((r) => ({ ad_name: (adNames[r.meta_ad_id] || {}).ad || null, ad_campaign: (adNames[r.meta_ad_id] || {}).campaign || null, id: r.id, name: r.name || [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || r.phone || '—', company: r.company, city: r.city, email: r.email, phone: r.phone, status: r.status || 'new', status_label: CMP_STATUS[r.status || 'new'] || r.status, hot: !!r.is_hot, test: !!r.is_test, created_at: r.created_at, last_called_at: r.last_called_at, owner: r.owner_person_id ? (pname[r.owner_person_id] || ('#' + r.owner_person_id)) : (r.external_rep_id ? (reps[r.external_rep_id] || ('externí #' + r.external_rep_id)) : ''), specialist_opened: !!r.ai_specialist_opened_at, schuzka_opened: !!r.schuzka_opened_at, ad_id: r.meta_ad_id, lead_id: r.meta_lead_id, via: (function () { const first = String(r.activity_log || '').split('\n')[0]; if (/napřímo/.test(first)) return 'napřímo'; if (/Lead přijat z FB|FB reklam/i.test(first) || r.meta_form_id || r.meta_lead_id || r.source === 'facebook_ads') return 'Make / webhook'; return 'ručně'; })(), notes: r.notes ? String(r.notes).slice(0, 200) : '' })) });
  } catch (err) { next(err); } });

// ── Leady z Facebooku napřímo (bez Make.com): stav oprávnění, stránky + formuláře, nastavení pollingu, ruční stažení ──
const leadsSync = require('../services/ads/meta-leads-sync');
router.get('/meta/leads-sync', async (req, res) => {
  try { const c = await leadsSync.cfg(); let perms = null, pages = null, err = null; try { perms = await leadsSync.permissions(); pages = await leadsSync.pages(true); } catch (e) { err = e.message; }
    const oauth = await leadsSync.oauthStatus(); const webhookUrl = 'https://app.holyos.cz/api/compounder/fb-webhook'; res.json({ oauth, enabled: c.enabled !== false, forms_filter: c.forms || [], interval_min: Number(c.interval_min) || 1, since: c.since || null, pages_filter: c.pages || [], last_run: c.last_run || null, last_result: c.last_result || null, permissions: perms, pages, error: err, webhook: { url: webhookUrl, verify_token: process.env.META_LEAD_VERIFY_TOKEN || 'holyos-meta-verify', app_secret: !!process.env.META_APP_SECRET }, env_page_token: !!process.env.META_PAGE_ACCESS_TOKEN }); } catch (err) { res.status(400).json({ error: err.message }); } });
router.put('/meta/leads-sync', express.json({ limit: '20kb' }), async (req, res, next) => {
  try { const c = await leadsSync.cfg(); const b = req.body || {}; if (b.enabled != null) c.enabled = !!b.enabled; if (b.interval_min != null) c.interval_min = Math.max(1, Math.min(1440, parseInt(b.interval_min, 10) || 1)); if (b.since !== undefined) c.since = b.since ? new Date(b.since).toISOString() : null; if (Array.isArray(b.pages)) c.pages = b.pages.map(String).filter(Boolean); if (Array.isArray(b.forms)) c.forms = b.forms.map(String).filter(Boolean); if (b.form_names && typeof b.form_names === 'object') c.form_names = b.form_names; await leadsSync.saveCfg(c, req.user && req.user.id); res.json({ ok: true }); } catch (err) { next(err); } });
// Pracovní sada pro editor funelu: vybrané stránky + formuláře (s počtem leadů v HolyOS za období) – bez volání Mety.
router.get('/meta/working-set', async (req, res, next) => { try { const c = await leadsSync.cfg(); const { getSetting } = require('../services/settings'); const m = (await getSetting('ads_center.meta', { type: 'json', defaultValue: {} })) || {}; const days = parseDays(req.query.days, 30); const since = sinceDate(days); const formIds = (c.forms || []).map(String); const names = c.form_names || {}; const counts = {}; if (formIds.length) { const g = await prisma.compounderLead.groupBy({ by: ['meta_form_id'], where: { meta_form_id: { in: formIds }, created_at: rng(since) }, _count: { _all: true } }); g.forEach((x) => { counts[x.meta_form_id] = x._count._all; }); } res.json({ pages: (m.pages || []).filter((p) => !(c.pages || []).length || (c.pages || []).map(String).includes(String(p.id))).map((p) => ({ id: p.id, name: p.name })), forms: formIds.map((id) => ({ id, name: (names[id] && names[id].name) || ('formulář ' + id), page: (names[id] && names[id].page) || '', leads: counts[id] || 0 })), days }); } catch (err) { next(err); } });
// OAuth osobního FB účtu – start (redirect na Facebook) a návrat (uložení tokenů). Stav se podepisuje JWT (BS2_SSO_SECRET / JWT_SECRET).
const OAUTH_REDIRECT = () => (process.env.APP_URL || 'https://app.holyos.cz').replace(/\/$/, '') + '/api/ads-center/meta/oauth/callback';
// Stav (CSRF) = náhodný řetězec uložený v AppSetting s časem; callback je navíc chráněn requireAuth + bs2Allowed.
const OAUTH_STATE_KEY = 'ads_center.oauth_state';
router.get('/meta/oauth/start', async (req, res) => { try { const { setSetting } = require('../services/settings'); const state = require('crypto').randomBytes(16).toString('hex'); await setSetting(OAUTH_STATE_KEY, { state, at: Date.now(), user: req.user && req.user.id }, { type: 'json', description: 'Centrum reklamy – OAuth stav (dočasné)', scope: 'marketing' }); res.redirect(leadsSync.oauthUrl(OAUTH_REDIRECT(), state)); } catch (err) { res.status(400).send('Nelze spustit přihlášení: ' + err.message); } });
router.get('/meta/oauth/callback', async (req, res) => {
  const back = '/modules/centrum-reklamy/index.html#settings';
  try { if (req.query.error) throw new Error(String(req.query.error_description || req.query.error)); const { getSetting } = require('../services/settings'); const st = (await getSetting(OAUTH_STATE_KEY, { type: 'json', defaultValue: null })) || {}; const got = String(req.query.state || '').replace(/#.*$/, ''); if (!st.state || st.state !== got || Date.now() - Number(st.at || 0) > 20 * 60000) { console.warn('[ads-center] OAuth state mismatch', { expected: st.state, got, age: Date.now() - Number(st.at || 0) }); throw new Error('Neplatný stav přihlášení (state) – zkus to znovu'); }
    const r = await leadsSync.oauthFinish(String(req.query.code || ''), OAUTH_REDIRECT(), req.user && req.user.id);
    res.redirect(back + '&fb=ok&pages=' + encodeURIComponent(r.pages.length)); } catch (err) { res.redirect(back + '&fb=err&msg=' + encodeURIComponent(err.message)); } });
router.post('/meta/oauth/disconnect', async (req, res, next) => { try { await leadsSync.oauthDisconnect(req.user && req.user.id); res.json({ ok: true }); } catch (err) { next(err); } });
// Oprava leadů stažených napřímo před opravou mapování polí (name 'FB lead', bez kontaktu): doplní jméno/e-mail/telefon z meta_raw;
// pokud po doplnění jde o duplicitu staršího kontaktu (stejný e-mail/telefon), chybně založený záznam se smaže.
router.post('/meta/leads-sync/repair', async (req, res, next) => {
  try { const cmp = require('./compounder.routes'); const rows = await prisma.compounderLead.findMany({ where: { OR: [{ name: 'FB lead' }, { AND: [{ email: null }, { phone: null }] }], meta_lead_id: { not: null }, meta_raw: { not: null } }, select: { id: true, name: true, email: true, phone: true, meta_raw: true, meta_lead_id: true, created_at: true, activity_log: true } });
    let fixed = 0, removed = 0, skipped = 0;
    for (const r of rows) { const raw = r.meta_raw || {}; const f = cmp._fbExtractFields(raw); let first = String(f.first_name || '').trim(), last = String(f.last_name || '').trim(); const full = String(f.full_name || f.name || '').trim(); if (!first && full) { const p = full.split(/\s+/); first = p[0] || ''; last = p.slice(1).join(' '); } const email = String(f.email || '').trim().toLowerCase() || null; const phone = String(f.phone || f.phone_number || '').trim() || null; const name = ([first, last].filter(Boolean).join(' ') || String(f.company || '').trim() || email || phone || null);
      if (!email && !phone && !name) { skipped++; continue; }
      const dupOr = []; if (email) dupOr.push({ email: { equals: email, mode: 'insensitive' } }); if (phone) dupOr.push({ phone });
      const older = dupOr.length ? await prisma.compounderLead.findFirst({ where: { OR: dupOr, id: { not: r.id } }, orderBy: { created_at: 'asc' }, select: { id: true, activity_log: true } }) : null;
      if (older) { const line = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' · Nová reakce z FB reklamy (napřímo, lead ' + r.meta_lead_id + ') — kontakt už v systému.'; await prisma.compounderLead.update({ where: { id: older.id }, data: { activity_log: line + (older.activity_log ? '\n' + older.activity_log : '') } }).catch(() => {}); await prisma.compounderLead.delete({ where: { id: r.id } }); removed++; continue; }
      await prisma.compounderLead.update({ where: { id: r.id }, data: { name: (name || r.name || 'FB lead').slice(0, 255), first_name: first ? first.slice(0, 120) : undefined, last_name: last ? last.slice(0, 120) : undefined, email: email ? email.slice(0, 255) : undefined, phone: phone ? phone.slice(0, 40) : undefined, company: f.company ? String(f.company).slice(0, 200) : undefined, city: f.city ? String(f.city).slice(0, 120) : undefined } }); fixed++; try { await cmp.rerunAutosend(r.id); } catch (e) { /* automat best-effort */ } } // po doplnění kontaktů znovu spustit automat (SMS / e-mail)
    res.json({ ok: true, checked: rows.length, fixed, removed, skipped }); } catch (err) { next(err); } });
router.post('/meta/leads-sync/run', express.json({ limit: '10kb' }), async (req, res) => { try { const b = req.body || {}; const r = await leadsSync.sync({ since: b.since || undefined }); res.json(r); } catch (err) { res.status(400).json({ error: err.message }); } });

// ── Komunikační kanály pro akční prvky funelu (e-mail, SMS) ──
// Přehled: ze kterých schránek umí HolyOS odesílat (Graph send-as / SMTP) a z jakého čísla / brány chodí SMS.
// Tajné hodnoty (hesla, tokeny) se nikdy nevrací. Výchozí odesílatel pro funely se ukládá v AppSetting ads_center.channels.
const CHANNELS_KEY = 'ads_center.channels';
const MAIL_SENDERS = [
  { env: 'COMPOUNDER_MAIL_FROM', nameEnv: 'COMPOUNDER_MAIL_FROM_NAME', use: 'Compounder (leady, model, rezervace)' },
  { env: 'COMPOUNDER_SPECIALIST_MAIL_FROM', use: 'AI specialista Compounder' },
  { env: 'BS2_MAIL_FROM', nameEnv: 'BS2_MAIL_FROM_NAME', use: 'Best Series 2.0 (účty, objednávky, Prověření lokality)', fallback: 'info@pradlomaty.info' },
  { env: 'VYBERY_MAIL_FROM', nameEnv: 'VYBERY_MAIL_FROM_NAME', use: 'Výběry / pokladna' },
  { env: 'SERVICE_BILLING_MAIL_FROM', nameEnv: 'SERVICE_BILLING_MAIL_FROM_NAME', use: 'Servisní fakturace' },
  { env: 'LEASING_MAIL_FROM', use: 'Leasing' },
  { env: 'INFOLINKA_MAIL_FROM', use: 'Infolinka (shrnutí hovorů)' },
  { env: 'SMTP_FROM', use: 'Systémový (SMTP záloha)' },
];
function parseAddr(s) { const m = String(s || '').match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/); return m ? { name: m[1].trim(), address: m[2].trim() } : { name: '', address: String(s || '').trim() }; }
// Odkud a kam chodí automatické oslovení nových leadů (Compounder): odesílatel e-mailu + cílové stránky odkazů v SMS / e-mailu.
function autosendView() {
  let links = { specialist: '', schuzka: '' };
  try { const cmp = require('./compounder.routes'); links = { specialist: String(cmp.specialistShortLink(0, 'sms')).replace(/\/s\/[^?]*/, '/s/…'), schuzka: String(cmp.schuzkaShortLink(0)).replace(/\/c\/.*$/, '/c/… → rezervace termínu') }; } catch (_) { /* bez Compounderu */ }
  const raw = process.env.COMPOUNDER_SPECIALIST_MAIL_FROM || process.env.COMPOUNDER_MAIL_FROM || '';
  return { email_from: raw, links };
}
async function channelsView() {
  const { getSetting } = require('../services/settings');
  const saved = (await getSetting(CHANNELS_KEY, { type: 'json', defaultValue: {} })) || {};
  let graphReady = false; try { const g = require('../services/ms-graph-client'); graphReady = !!(g.isConfigured && g.isConfigured()); } catch (_) { /* bez Graphu */ }
  const smtpReady = !!process.env.SMTP_HOST;
  const seen = new Set(); const senders = [];
  MAIL_SENDERS.forEach((d) => { const raw = process.env[d.env] || d.fallback || ''; if (!raw) return; const p = parseAddr(raw); if (!p.address || seen.has(p.address.toLowerCase())) { if (p.address) { const ex = senders.find((x) => x.address.toLowerCase() === p.address.toLowerCase()); if (ex) ex.use += ', ' + d.use; } return; } seen.add(p.address.toLowerCase()); senders.push({ address: p.address, name: (d.nameEnv && process.env[d.nameEnv]) || p.name || '', use: d.use, env: d.env, via: graphReady ? 'graph' : (smtpReady ? 'smtp' : 'none') }); });
  try { const M = require('../services/ses/mailer'); if (M.isConfigured()) { const p = parseAddr(M.smtpConf().from); if (p.address && seen.has(p.address.toLowerCase())) { const ex = senders.find((y) => y.address.toLowerCase() === p.address.toLowerCase()); if (ex) { ex.via = 'ses'; ex.ses = true; ex.use = 'Amazon SES' + (M.configSet() ? ' · sledování zapnuto' : '') + (ex.use ? ' · ' + ex.use : ''); } } if (p.address && !seen.has(p.address.toLowerCase())) { seen.add(p.address.toLowerCase()); senders.unshift({ address: p.address, name: p.name || '', use: 'Amazon SES' + (M.configSet() ? ' · sledování zapnuto' : ' · bez sledování'), env: 'SMTP_FROM', via: 'ses', ses: true }); }
    (await M.sesSenders()).filter((x) => x.extra).forEach((x) => { const a = x.address.toLowerCase(); if (seen.has(a)) { const ex = senders.find((y) => y.address.toLowerCase() === a); if (ex) { ex.via = 'ses'; ex.ses = true; } return; } seen.add(a); senders.splice(1, 0, { address: x.address, name: x.name || '', use: 'Amazon SES · další odesílatel' + (M.configSet() ? ' · sledování zapnuto' : ''), env: '', via: 'ses', ses: true }); }); } } catch (e) { /* bez SES */ }
  try { const gw = await require('../services/email').getGateway(true); if (gw && gw.host && gw.from) { const p = parseAddr(gw.from); if (p.address) { seen.add(p.address.toLowerCase()); senders.unshift({ address: p.address, name: p.name || gw.from_name || '', use: 'SMTP brána (' + gw.host + ')', env: '', via: 'smtp-gateway', gateway: true }); } } } catch (e) { /* bez brány */ }
  (Array.isArray(saved.extra_senders) ? saved.extra_senders : []).forEach((a) => { const p = parseAddr(a); if (p.address && !seen.has(p.address.toLowerCase())) { seen.add(p.address.toLowerCase()); senders.push({ address: p.address, name: p.name, use: 'vlastní (přidáno v nastavení)', env: '', custom: true, via: graphReady ? 'graph' : (smtpReady ? 'smtp' : 'none') }); } });
  let sms = { provider: 'twilio', gosms_channel: '', twilio_sms_from: '', gosms_ready: false, twilio_ready: false };
  try { sms = await require('../services/voice/sms').getSmsConfigView(); } catch (_) { /* bez SMS služby */ }
  // Twilio čísla linek (volané číslo → linka) + výchozí odchozí číslo hlasového agenta
  let lineNumbers = {}; try { let m = await getSetting('voice.line_numbers'); if (typeof m === 'string') m = JSON.parse(m); if (m && typeof m === 'object') lineNumbers = m; } catch (_) { /* není */ }
  const smsFrom = sms.provider === 'gosms' ? (sms.gosms_channel ? 'GoSMS kanál #' + sms.gosms_channel : '') : sms.twilio_sms_from;
  return {
    email: { graph_ready: graphReady, smtp_ready: smtpReady, senders, default_from: saved.email_from || (senders[0] && senders[0].address) || '' },
    autosend: autosendView(),
    sms: { provider: sms.provider, ready: sms.provider === 'gosms' ? sms.gosms_ready : sms.twilio_ready, from: smsFrom, from_detail: sms.provider === 'gosms' ? 'GoSMS.cz – odesílatel je nastaven jako kanál v portálu GoSMS (typicky „Pradlomaty").' : (String(sms.twilio_sms_from || '').startsWith('MG') ? 'Twilio Messaging Service (' + sms.twilio_sms_from + ')' : 'Twilio číslo / alfanumerický odesílatel'), voice_default_from: process.env.VOICE_DEFAULT_FROM || '', line_numbers: Object.entries(lineNumbers).map(([num, line]) => ({ number: num, line })), settings_url: '/modules/servis/index.html#infolinka' },
  };
}
// Statistika automatického oslovení pro uzly SMS / e-mail ve funelu: kolik leadů z formuláře dostalo SMS / e-mail a kolik otevřelo odkaz.
router.get('/autosend/stats', async (req, res, next) => {
  try {
    const formId = String(req.query.form || '').trim(); const days = parseDays(req.query.days, 30);
    const where = { created_at: rng(sinceDate(days)) }; if (formId) where.meta_form_id = formId; // days=0 → dnes od půlnoci (stejně jako ostatní čísla ve funelu)
    const c = (extra) => prisma.compounderLead.count({ where: Object.assign({}, where, extra) });
    const [leads, spSms, spMail, spOpen, scSms, scMail, scOpen, spReach, scReach] = await Promise.all([
      c({}), c({ ai_specialist_sms_sent_at: { not: null } }), c({ ai_specialist_email_sent_at: { not: null } }), c({ ai_specialist_opened_at: { not: null } }),
      c({ schuzka_sms_sent_at: { not: null } }), c({ schuzka_email_sent_at: { not: null } }), c({ schuzka_opened_at: { not: null } }),
      c({ OR: [{ ai_specialist_sms_sent_at: { not: null } }, { ai_specialist_email_sent_at: { not: null } }] }), c({ OR: [{ schuzka_sms_sent_at: { not: null } }, { schuzka_email_sent_at: { not: null } }] }),
    ]);
    res.json({ leads, specialist: { sms: spSms, email: spMail, opened: spOpen, reached: spReach }, schuzka: { sms: scSms, email: scMail, opened: scOpen, reached: scReach } });
  } catch (err) { next(err); }
});
router.get('/channels', async (req, res, next) => { try { res.json(await channelsView()); } catch (err) { next(err); } });
router.put('/channels', express.json({ limit: '20kb' }), async (req, res, next) => {
  try { const { getSetting, setSetting } = require('../services/settings'); const cur = (await getSetting(CHANNELS_KEY, { type: 'json', defaultValue: {} })) || {}; const b = req.body || {};
    const v = { email_from: b.email_from != null ? String(b.email_from).trim() : (cur.email_from || ''), extra_senders: Array.isArray(b.extra_senders) ? b.extra_senders.map((s) => String(s).trim()).filter((s) => /@/.test(s)).slice(0, 20) : (cur.extra_senders || []) };
    await setSetting(CHANNELS_KEY, v, { type: 'json', description: 'Centrum reklamy – komunikační kanály (výchozí e-mailový odesílatel, vlastní schránky)', scope: 'marketing', userId: req.user && req.user.id });
    res.json({ ok: true }); } catch (err) { next(err); } });
// Testovací odeslání – ověří, že Graph/SMTP schránku skutečně pustí (odešle krátký e-mail / SMS na zadanou adresu / číslo).
// ── SMTP brána (Brevo / Amazon SES / M365) – nastavitelná v UI, heslo se nikdy nevrací ──
// ── Amazon SES brána (env-first): stav + statistiky odeslání (open/click/bounce) ──
router.get('/channels/ses', async (req, res) => { const M = require('../services/ses/mailer'); const sesS = await M.sesSenders().catch(() => []); const c = M.smtpConf(); const api = M.mode() === 'api'; const ak = M.apiConf(); res.json({ configured: M.isConfigured(), mode: M.mode(), host: api ? 'API email.' + ak.region + '.amazonaws.com' : c.host, port: api ? 443 : c.port, secure: c.secure, user: api ? ak.id.slice(0, 4) + '…' : (c.user ? c.user.slice(0, 4) + '…' : ''), from: c.from, configuration_set: M.configSet(), tracking: !!M.configSet(), public_base_url: process.env.PUBLIC_BASE_URL || '', webhook: (process.env.PUBLIC_BASE_URL || 'https://app.holyos.cz').replace(/\/+$/, '') + '/webhooks/ses', senders: sesS }); });
// PUT /api/ads-center/channels/ses/senders { senders: ["Prádlomaty <info@pradlomaty.info>", …] } — další odesílatelé přes SES (doména musí být ověřená v AWS SES)
router.put('/channels/ses/senders', express.json({ limit: '10kb' }), async (req, res, next) => { try { const M = require('../services/ses/mailer'); const list = (Array.isArray(req.body && req.body.senders) ? req.body.senders : []).map((x) => String(x || '').trim()).filter((x) => /@[^@\s>]+\.[a-z]{2,}/i.test(x)).slice(0, 30); const { setSetting } = require('../services/settings'); await setSetting(M.SENDERS_KEY, list, { type: 'json', description: 'Centrum reklamy – další odesílatelé přes Amazon SES', scope: 'marketing', userId: req.user && req.user.id }); res.json({ ok: true, senders: await M.sesSenders() }); } catch (err) { next(err); } });
router.post('/channels/ses/verify', async (req, res) => { const r = await require('../services/ses/mailer').verify(); res.status(r.ok ? 200 : 400).json(r); });
router.post('/channels/ses/test', express.json({ limit: '10kb' }), async (req, res) => { try { const to = String((req.body && req.body.to) || (req.user && req.user.email) || '').trim(); if (!to) return res.status(400).json({ error: 'Chybí adresa' }); const M = require('../services/ses/mailer'); if (!M.isConfigured()) return res.status(400).json({ error: 'SES není nastaveno (SMTP_HOST / SMTP_USER / SMTP_PASS)' }); const EL = require('../services/ses/email-log'); const subj = 'Test Amazon SES – Best Series 2.0'; let fromT; if (req.body && req.body.from) { const ss = await M.sesSenderFor(req.body.from); if (!ss) return res.status(400).json({ error: 'Odesílatel není mezi odesílateli SES' }); fromT = ss.raw; } const r = await M.sendEmail({ to, from: fromT, subject: subj, text: 'Testovací e-mail z brány Amazon SES (HolyOS Centrum reklamy).\n\nPokud tento e-mail vidíte, SMTP přihlášení funguje. Otevření a proklik se propíší přes SNS webhook.\n\nOdkaz pro test prokliku: https://www.bestseries2.cz/location', preheader: 'Test brány Amazon SES', unsubscribeUrl: EL.unsubscribeUrl(to) }); await EL.logMessage(r, { to, subject: subj, campaignId: 'test' }); if (!r.ok) return res.status(400).json({ error: r.error }); res.json({ ok: true, to, simulated: !!r.simulated, sesMessageId: r.sesMessageId || null }); } catch (err) { res.status(400).json({ error: err.message }); } });
router.get('/email-stats', async (req, res, next) => { try { res.json(await require('../services/ses/email-log').stats(String(req.query.range || '30d'))); } catch (err) { next(err); } });
router.get('/channels/smtp', async (req, res, next) => { try { const gw = (await require('../services/email').getGateway(true)) || {}; res.json({ host: gw.host || '', port: gw.port || 587, user: gw.user || '', has_pass: !!gw.pass, from: gw.from || '', from_name: gw.from_name || '', secure: !!gw.secure, test_to: gw.test_to || '', default_for_all: !!gw.default_for_all }); } catch (err) { next(err); } });
router.put('/channels/smtp', express.json({ limit: '20kb' }), async (req, res, next) => { try { const { getSetting, setSetting } = require('../services/settings'); const cur = (await getSetting(require('../services/email').GATEWAY_KEY, { type: 'json', defaultValue: {} })) || {}; const b = req.body || {};
  const v = { host: String(b.host || '').trim().slice(0, 200), port: parseInt(b.port, 10) || 587, user: String(b.user || '').trim().slice(0, 200), pass: b.pass ? String(b.pass).slice(0, 500) : (cur.pass || ''), from: String(b.from || '').trim().slice(0, 200), from_name: String(b.from_name || '').trim().slice(0, 100), secure: !!b.secure, test_to: String(b.test_to || '').trim().slice(0, 200), default_for_all: !!b.default_for_all };
  await setSetting(require('../services/email').GATEWAY_KEY, v, { type: 'json', description: 'Centrum reklamy – SMTP brána pro e-maily (Brevo / SES / M365)', scope: 'marketing', userId: req.user && req.user.id }); await require('../services/email').getGateway(true); res.json({ ok: true }); } catch (err) { next(err); } });
router.post('/channels/smtp/test', express.json({ limit: '20kb' }), async (req, res) => { try { const E = require('../services/email'); const b = req.body || {}; const saved = (await E.getGateway(true)) || {}; const cfg = Object.assign({}, saved, { host: b.host || saved.host, port: b.port || saved.port, user: b.user != null && b.user !== '' ? b.user : saved.user, pass: b.pass ? b.pass : saved.pass, from: b.from || saved.from, from_name: b.from_name != null ? b.from_name : saved.from_name, secure: b.secure != null ? !!b.secure : !!saved.secure }); const to = String(b.to || saved.test_to || (req.user && req.user.email) || '').trim(); if (!cfg.host || !cfg.from) return res.status(400).json({ error: 'Vyplň host a odesílatele' }); if (!to) return res.status(400).json({ error: 'Chybí adresa pro test' }); const r = await E.testGateway(cfg, to); if (!r.ok) return res.status(400).json({ error: r.error }); res.json({ ok: true, to }); } catch (err) { res.status(400).json({ error: err.message }); } });
router.post('/channels/test-email', express.json({ limit: '10kb' }), async (req, res) => {
  try { const b = req.body || {}; const to = String(b.to || (req.user && req.user.email) || '').trim(); if (!to) return res.status(400).json({ error: 'Chybí adresa příjemce' });
    const r = await require('../services/email').sendMail({ to, from: String(b.from || '').trim() || undefined, subject: 'HolyOS – test odesílatele', body: 'Testovací e-mail z Centra reklamy. Odesílatel: ' + (b.from || 'výchozí') + '.', link: 'https://app.holyos.cz/modules/centrum-reklamy/index.html#settings', linkLabel: 'Centrum reklamy' });
    if (!r.sent) return res.status(400).json({ error: r.error || r.skipped || 'neodesláno' }); res.json({ ok: true, via: r.via, from: r.from || b.from || '' }); } catch (err) { res.status(400).json({ error: err.message }); } });
router.post('/channels/test-sms', express.json({ limit: '10kb' }), async (req, res) => {
  try { const to = String((req.body || {}).to || '').trim(); if (!to) return res.status(400).json({ error: 'Chybí číslo příjemce' });
    const id = await require('../services/voice/sms').sendSms(to, 'HolyOS – test SMS brány z Centra reklamy.', { source: 'ads_center_test' }); res.json({ ok: true, id }); } catch (err) { res.status(400).json({ error: err.message }); } });

module.exports = router;
module.exports.PAGES = PAGES;
