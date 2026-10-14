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
router.use(async (req, res, next) => { try { if (!(await bs2Allowed(req.user))) return res.status(403).json({ error: 'Do této sekce nemáš přístup.' }); next(); } catch (e) { next(e); } });

// Definice záchytných stránek. visits = jak se počítají unikátní návštěvníci (událost + cesta),
// leads = jak se počítají leady/objednávky. bs2 = data z Best Series 2.0.
const PAGES = [
  { key: 'bs2_location', name: 'Prověření lokality', url: 'https://www.bestseries2.cz/location', desc: 'Prodejní stránka online aplikace (balíčky Základ / Plus / Premium, platba Stripe).', admin: 'https://www.bestseries2.cz/admin/online', color: '#4fd1ff', bs2: { path: '/location' }, leadLabel: 'objednávky', convLabel: 'zaplaceno' },
  { key: 'bs2_home', name: 'Best Series 2.0 – teaser /home', url: 'https://www.bestseries2.cz/home', desc: 'Úvodní teaser s odpočtem a sběrem e-mailů.', admin: 'https://www.bestseries2.cz/admin', color: '#7c5cff', bs2: { path: '/home' } },
  { key: 'misto', name: 'První prádlomat: prověř místo', url: 'https://pradlomaty.info/misto', desc: 'Veřejná stránka s balíčky prověření místa (žádosti + Stripe).', admin: '/modules/prodejni-objednavky/index.html', color: '#2fe3a0', visits: { event: 'misto_view' }, leads: { source: ['misto'] }, leadLabel: 'žádosti' },
  { key: 'compounder', name: 'Compounder.world', url: 'https://compounder.world', desc: 'Brandový web Compounderu – registrace leadů, portál, AI specialista.', admin: '/modules/prodejni-objednavky/index.html', color: '#f59e0b', visits: { event: 'page_view', pathNot: ['/misto', '/cesta', '/location', '/home'] }, leads: { source: ['web', 'google_ads', 'facebook', 'fb', 'fb_lead_ads', 'google'] }, leadLabel: 'leady' },
  { key: 'cesta', name: 'Cesta k rozhodnutí (pradlomaty /home, /cesta)', url: 'https://pradlomaty.info/home', desc: 'Modrá „cesta k rozhodnutí" pro zájemce o prádlomat.', admin: '/modules/prodejni-objednavky/index.html', color: '#1e86e0', visits: { event: 'page_view', pathIn: ['/home', '/cesta'] } },
  { key: 'lokality', name: 'Lokality – bestseries.global', url: 'https://bestseries.global', desc: 'Veřejná nabídka míst pro prádlomat (předjednaná místa).', admin: '/modules/prodejni-objednavky/index.html', color: '#a78bfa', visits: { event: 'lok_view' }, inquiries: true, leadLabel: 'poptávky' },
  { key: 'spare', name: 'Spare Parts Shop', url: 'https://bestseries.cash/spare-parts', desc: 'E-shop náhradních dílů (EUR).', admin: '/modules/eshop/index.html', color: '#22d3ee', visits: { event: 'shop_view' }, shop: true, leadLabel: 'objednávky' },
];

function sinceDate(days) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - days + 1); return d; }
function dayKey(d) { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }
function dayKeys(days) { const out = []; const s = sinceDate(days); for (let i = 0; i < days; i++) { const d = new Date(s); d.setDate(s.getDate() + i); out.push(dayKey(d)); } return out; }

// Unikátní návštěvníci (sid) po dnech podle definice události/cesty
async function visitSeries(def, days) {
  const since = sinceDate(days);
  const where = { event: def.event, created_at: { gte: since } };
  if (def.pathIn) where.OR = def.pathIn.map((p) => ({ path: { startsWith: p } }));
  const rows = await prisma.compounderEvent.findMany({ where, select: { sid: true, path: true, created_at: true } });
  const perDay = {}; const all = new Set();
  rows.forEach((r) => {
    if (def.pathNot && def.pathNot.some((p) => String(r.path || '').startsWith(p))) return;
    const k = dayKey(r.created_at); (perDay[k] = perDay[k] || new Set()).add(r.sid); all.add(r.sid);
  });
  return { series: dayKeys(days).map((k) => ({ d: k, n: perDay[k] ? perDay[k].size : 0 })), uniques: all.size };
}

async function bs2Stats(days) {
  const secret = process.env.BS2_SSO_SECRET, base = String(process.env.BS2_URL || 'https://www.bestseries2.cz').replace(/\/$/, '');
  if (!secret) return null;
  const token = jwt.sign({ aud: 'bs2-api', iss: 'holyos' }, secret, { expiresIn: '1m' });
  const r = await fetch(base + '/api/holyos/ads-stats?days=' + days, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('BS2 ' + r.status);
  return r.json();
}

// GET /api/ads-center/overview?days=30
router.get('/overview', async (req, res, next) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const since = sinceDate(days);
    let bs2 = null, bs2Err = null; try { bs2 = await bs2Stats(days); } catch (e) { bs2Err = e.message; }
    const leadsBySource = await prisma.compounderLead.groupBy({ by: ['source'], where: { created_at: { gte: since } }, _count: { _all: true } }).catch(() => []);
    const leadsByDay = await prisma.compounderLead.findMany({ where: { created_at: { gte: since } }, select: { source: true, created_at: true } }).catch(() => []);
    const inquiries = await prisma.pradlomatSpotInquiry.findMany({ where: { created_at: { gte: since } }, select: { created_at: true } }).catch(() => []);
    const shop = await prisma.shopOrder.findMany({ where: { created_at: { gte: since } }, select: { created_at: true, total_incl_vat: true, status: true } }).catch(() => []);
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
    res.json({ days, generatedAt: new Date().toISOString(), pages: out });
  } catch (err) { next(err); }
});

// ── Funely: uživatelsky definované posloupnosti kroků (stránka + metrika), uloženo v AppSetting ──
const FUNNELS_KEY = 'ads_center.funnels';
const METRICS = ['uniques', 'leads', 'conversions'];
async function loadFunnels() { const { getSetting } = require('../services/settings'); const v = await getSetting(FUNNELS_KEY, { type: 'json', defaultValue: [] }); return Array.isArray(v) ? v : []; }
function cleanFunnel(f) {
  const keys = new Set(PAGES.map((p) => p.key));
  return { id: String(f.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 40), name: String(f.name || 'Funel').slice(0, 80), note: String(f.note || '').slice(0, 300),
    steps: (Array.isArray(f.steps) ? f.steps : []).slice(0, 12).map((st) => ({ label: String(st.label || '').slice(0, 60), page: keys.has(st.page) ? st.page : null, metric: METRICS.includes(st.metric) ? st.metric : 'uniques', manual: st.manual != null && st.manual !== '' ? Number(st.manual) : null })) };
}
router.get('/funnels', async (req, res, next) => { try { res.json(await loadFunnels()); } catch (err) { next(err); } });
router.put('/funnels', express.json({ limit: '200kb' }), async (req, res, next) => {
  try {
    const { setSetting } = require('../services/settings');
    const list = (Array.isArray(req.body) ? req.body : []).slice(0, 50).map(cleanFunnel);
    await setSetting(FUNNELS_KEY, list, { type: 'json', description: 'Centrum reklamy – definice funelů', scope: 'marketing', userId: req.user && req.user.id });
    res.json(list);
  } catch (err) { next(err); }
});
router.get('/pages', (req, res) => res.json(PAGES.map((p) => ({ key: p.key, name: p.name, color: p.color, leadLabel: p.leadLabel || 'leady', convLabel: p.convLabel || 'dokončeno' }))));

module.exports = router;
