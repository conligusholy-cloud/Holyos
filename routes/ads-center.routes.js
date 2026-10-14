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
  const cleanStep = (st) => ({ label: String(st.label || '').slice(0, 60), page: keys.has(st.page) ? st.page : null, metric: METRICS.includes(st.metric) ? st.metric : 'uniques', manual: st.manual != null && st.manual !== '' ? Number(st.manual) : null });
  // Vizuální editor: nodes (uzly s pozicí) + edges (spojnice). Kroky funelu se odvodí průchodem řetězce od uzlu bez vstupu.
  const nodes = (Array.isArray(f.nodes) ? f.nodes : []).slice(0, 60).map((nd) => Object.assign(cleanStep(nd), { id: String(nd.id || '').slice(0, 24), x: Math.round(Number(nd.x) || 0), y: Math.round(Number(nd.y) || 0), kind: nd.kind === 'note' ? 'note' : nd.kind === 'start' ? 'start' : 'step', text: String(nd.text || '').slice(0, 300), meta: nd.meta && nd.meta.campaign ? { campaign: { id: String(nd.meta.campaign.id || '').slice(0, 40), name: String(nd.meta.campaign.name || '').slice(0, 120), status: String(nd.meta.campaign.status || '').slice(0, 40), impressions: Number(nd.meta.campaign.impressions) || 0, reach: Number(nd.meta.campaign.reach) || 0, link_clicks: Number(nd.meta.campaign.link_clicks) || 0, leads: Number(nd.meta.campaign.leads) || 0, spend: Number(nd.meta.campaign.spend) || 0, endpoint: String(nd.meta.campaign.endpoint || '').slice(0, 300) } } : null }));
  const ids = new Set(nodes.map((x) => x.id));
  const edges = (Array.isArray(f.edges) ? f.edges : []).slice(0, 120).map((e) => ({ from: String(e.from || ''), to: String(e.to || '') })).filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  let steps = (Array.isArray(f.steps) ? f.steps : []).slice(0, 12).map(cleanStep);
  if (nodes.length) {
    const hasIn = new Set(edges.map((e) => e.to)); const stepNodes = nodes.filter((x) => x.kind !== 'note');
    let cur = stepNodes.find((x) => x.kind === 'start') || stepNodes.find((x) => !hasIn.has(x.id)); const seen = new Set(); steps = [];
    while (cur && !seen.has(cur.id) && steps.length < 12) { seen.add(cur.id); steps.push(Object.assign(cleanStep(cur), cur.kind === 'start' ? { label: cur.label || 'Facebook reklama', page: null } : {})); const e = edges.find((ed) => ed.from === cur.id); cur = e ? nodes.find((x) => x.id === e.to && x.kind !== 'note') : null; }
  }
  return { id: String(f.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 40), name: String(f.name || 'Funel').slice(0, 80), note: String(f.note || '').slice(0, 300), steps, nodes, edges };
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

// ── Meta (Facebook) Ads: napojení na reklamní účet, seznam kampaní, statistiky a nastavení (cíl = URL / lead formulář) ──
// Přístupový token s právem ads_read (System User token v Business Manageru) + ID reklamního účtu se ukládají v AppSetting
// (nebo env META_ADS_ACCESS_TOKEN / META_AD_ACCOUNT_ID). Token se nikdy nevrací do prohlížeče.
const META_KEY = 'ads_center.meta';
const GRAPH = 'https://graph.facebook.com/v19.0/';
async function metaCfg() { const { getSetting } = require('../services/settings'); const v = (await getSetting(META_KEY, { type: 'json', defaultValue: {} })) || {}; return { token: v.token || process.env.META_ADS_ACCESS_TOKEN || '', account: String(v.account || process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, ''), source: v.token ? 'nastavení' : (process.env.META_ADS_ACCESS_TOKEN ? 'env' : '') }; }
async function graph(path, params, token) { const u = new URL(GRAPH + path); Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, v)); u.searchParams.set('access_token', token); const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); const j = await r.json().catch(() => ({})); if (!r.ok || j.error) throw new Error((j.error && j.error.message) || ('Meta ' + r.status)); return j; }
router.get('/meta/config', async (req, res, next) => { try { const c = await metaCfg(); res.json({ connected: !!(c.token && c.account), account: c.account, source: c.source, hasToken: !!c.token }); } catch (err) { next(err); } });
router.put('/meta/config', express.json({ limit: '20kb' }), async (req, res, next) => {
  try { const { getSetting, setSetting } = require('../services/settings'); const cur = (await getSetting(META_KEY, { type: 'json', defaultValue: {} })) || {}; const b = req.body || {};
    const v = { token: b.token ? String(b.token).trim() : (b.clear ? '' : cur.token || ''), account: String(b.account != null ? b.account : cur.account || '').trim().replace(/^act_/, '') };
    await setSetting(META_KEY, v, { type: 'json', description: 'Centrum reklamy – Meta Ads napojení (token + reklamní účet)', scope: 'marketing', userId: req.user && req.user.id });
    res.json({ ok: true, connected: !!(v.token && v.account) }); } catch (err) { next(err); } });
router.get('/meta/test', async (req, res, next) => { try { const c = await metaCfg(); if (!c.token) return res.status(400).json({ error: 'Chybí token' }); const me = await graph('me', { fields: 'id,name' }, c.token); let acc = null; if (c.account) acc = await graph('act_' + c.account, { fields: 'id,name,account_status,currency,amount_spent' }, c.token); res.json({ me, account: acc }); } catch (err) { res.status(400).json({ error: err.message }); } });
router.get('/meta/accounts', async (req, res, next) => { try { const c = await metaCfg(); if (!c.token) return res.status(400).json({ error: 'Chybí token' }); const j = await graph('me/adaccounts', { fields: 'id,name,account_status,currency', limit: 100 }, c.token); res.json((j.data || []).map((a) => ({ id: String(a.id).replace(/^act_/, ''), name: a.name, status: a.account_status, currency: a.currency }))); } catch (err) { res.status(400).json({ error: err.message }); } });
// Kampaně se statistikami za období
router.get('/meta/campaigns', async (req, res, next) => {
  try { const c = await metaCfg(); if (!c.token || !c.account) return res.status(400).json({ error: 'Meta Ads nejsou napojené – otevři nastavení (ozubené kolečko).' });
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const j = await graph('act_' + c.account + '/campaigns', { fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,insights.date_preset(last_' + (days <= 7 ? '7d' : days <= 30 ? '30d' : '90d') + '){impressions,reach,clicks,spend,cpc,cpm,ctr,actions,cost_per_action_type}', limit: 100 }, c.token);
    const out = (j.data || []).map((k) => { const ins = (k.insights && k.insights.data && k.insights.data[0]) || {}; const act = (t) => { const a = (ins.actions || []).find((x) => x.action_type === t); return a ? Number(a.value) : 0; };
      return { id: k.id, name: k.name, status: k.effective_status || k.status, objective: k.objective, daily_budget: k.daily_budget ? Number(k.daily_budget) / 100 : null, lifetime_budget: k.lifetime_budget ? Number(k.lifetime_budget) / 100 : null, start: k.start_time, stop: k.stop_time,
        impressions: Number(ins.impressions || 0), reach: Number(ins.reach || 0), clicks: Number(ins.clicks || 0), spend: Number(ins.spend || 0), cpc: ins.cpc != null ? Number(ins.cpc) : null, cpm: ins.cpm != null ? Number(ins.cpm) : null, ctr: ins.ctr != null ? Number(ins.ctr) : null, link_clicks: act('link_click'), leads: act('lead') || act('onsite_conversion.lead_grouped'), landing_views: act('landing_page_view') }; });
    res.json({ days, campaigns: out });
  } catch (err) { res.status(400).json({ error: err.message }); } });
// Detail kampaně: sady + reklamy s koncovým bodem (odkaz na stránku / lead formulář) a statistikami
router.get('/meta/campaigns/:id', async (req, res, next) => {
  try { const c = await metaCfg(); if (!c.token || !c.account) return res.status(400).json({ error: 'Meta Ads nejsou napojené.' });
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30)); const preset = 'last_' + (days <= 7 ? '7d' : days <= 30 ? '30d' : '90d');
    const id = String(req.params.id).replace(/[^0-9]/g, '');
    const camp = await graph(id, { fields: 'id,name,status,effective_status,objective,buying_type,daily_budget,lifetime_budget,start_time,stop_time,special_ad_categories' }, c.token);
    const sets = await graph(id + '/adsets', { fields: 'id,name,status,effective_status,optimization_goal,billing_event,daily_budget,lifetime_budget,targeting{geo_locations,age_min,age_max,genders,interests},promoted_object,destination_type', limit: 50 }, c.token);
    const ads = await graph(id + '/ads', { fields: 'id,name,status,effective_status,adset_id,creative{id,name,object_story_spec,asset_feed_spec,call_to_action_type,link_url,object_url,effective_object_story_id},insights.date_preset(' + preset + '){impressions,reach,clicks,spend,ctr,cpc,actions}', limit: 100 }, c.token);
    const endpoint = (cr) => { if (!cr) return { type: 'unknown' }; const spec = cr.object_story_spec || {}; const ld = spec.link_data || {}; const vd = spec.video_data || {}; const cta = (ld.call_to_action || vd.call_to_action || {}); const lead = cta.value && (cta.value.lead_gen_form_id || cta.value.leadgen_form_id); if (lead) return { type: 'lead_form', form_id: lead, cta: cta.type || cr.call_to_action_type || null }; const link = ld.link || (vd.call_to_action && vd.call_to_action.value && vd.call_to_action.value.link) || cr.link_url || cr.object_url || (cr.asset_feed_spec && cr.asset_feed_spec.link_urls && cr.asset_feed_spec.link_urls[0] && cr.asset_feed_spec.link_urls[0].website_url) || null; if (link) return { type: 'website', url: link, cta: cta.type || cr.call_to_action_type || null }; return { type: 'other', cta: cta.type || cr.call_to_action_type || null }; };
    const formNames = {}; for (const a of ads.data || []) { const ep = endpoint(a.creative); if (ep.type === 'lead_form' && !formNames[ep.form_id]) { try { const f = await graph(ep.form_id, { fields: 'id,name,status,questions' }, c.token); formNames[ep.form_id] = { name: f.name, status: f.status, questions: (f.questions || []).map((q) => q.label || q.type) }; } catch (e) { formNames[ep.form_id] = { name: 'formulář ' + ep.form_id }; } } }
    res.json({ campaign: camp, adsets: (sets.data || []).map((s0) => ({ id: s0.id, name: s0.name, status: s0.effective_status || s0.status, optimization_goal: s0.optimization_goal, destination_type: s0.destination_type, daily_budget: s0.daily_budget ? Number(s0.daily_budget) / 100 : null, targeting: s0.targeting ? { countries: (s0.targeting.geo_locations || {}).countries, cities: ((s0.targeting.geo_locations || {}).cities || []).map((x) => x.name), age: [s0.targeting.age_min, s0.targeting.age_max], interests: (s0.targeting.interests || []).map((x) => x.name) } : null })),
      ads: (ads.data || []).map((a) => { const ins = (a.insights && a.insights.data && a.insights.data[0]) || {}; const ep = endpoint(a.creative); if (ep.type === 'lead_form') ep.form = formNames[ep.form_id]; return { id: a.id, name: a.name, status: a.effective_status || a.status, adset_id: a.adset_id, endpoint: ep, impressions: Number(ins.impressions || 0), clicks: Number(ins.clicks || 0), spend: Number(ins.spend || 0), ctr: ins.ctr != null ? Number(ins.ctr) : null, leads: ((ins.actions || []).find((x) => x.action_type === 'lead' || x.action_type === 'onsite_conversion.lead_grouped') || {}).value || 0 }; }) });
  } catch (err) { res.status(400).json({ error: err.message }); } });

module.exports = router;
