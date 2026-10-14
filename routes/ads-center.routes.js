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
  const nodes = (Array.isArray(f.nodes) ? f.nodes : []).slice(0, 60).map((nd) => Object.assign(cleanStep(nd), { id: String(nd.id || '').slice(0, 24), x: Math.round(Number(nd.x) || 0), y: Math.round(Number(nd.y) || 0), kind: nd.kind === 'note' ? 'note' : nd.kind === 'start' ? 'start' : nd.kind === 'leadform' ? 'leadform' : nd.kind === 'split' ? 'split' : 'step', branches: nd.kind === 'split' ? (Array.isArray(nd.branches) ? nd.branches : []).slice(0, 20).map((b) => ({ key: String(b.key || '').slice(0, 24), count: Math.max(0, Math.min(999, parseInt(b.count, 10) || 0)) })) : undefined, text: String(nd.text || '').slice(0, 300), form: nd.kind === 'leadform' && nd.form ? { form_id: nd.form.form_id ? String(nd.form.form_id).slice(0, 40) : null, name: String(nd.form.name || '').slice(0, 120), status: String(nd.form.status || '').slice(0, 30), questions: (Array.isArray(nd.form.questions) ? nd.form.questions : []).slice(0, 8).map((q) => String(q).slice(0, 60)), leads: Number(nd.form.leads) || 0, clicks: Number(nd.form.clicks) || 0, spend: Number(nd.form.spend) || 0, campaign_id: String(nd.form.campaign_id || '').slice(0, 40), campaign_name: String(nd.form.campaign_name || '').slice(0, 120), ad_ids: (Array.isArray(nd.form.ad_ids) ? nd.form.ad_ids : []).slice(0, 200).map((x) => String(x).replace(/[^0-9]/g, '')).filter(Boolean) } : undefined, meta: nd.meta && nd.meta.campaign ? { account: String(nd.meta.account || '').replace(/[^0-9]/g, '').slice(0, 30), campaign: { id: String(nd.meta.campaign.id || '').slice(0, 40), name: String(nd.meta.campaign.name || '').slice(0, 120), status: String(nd.meta.campaign.status || '').slice(0, 40), impressions: Number(nd.meta.campaign.impressions) || 0, reach: Number(nd.meta.campaign.reach) || 0, link_clicks: Number(nd.meta.campaign.link_clicks) || 0, leads: Number(nd.meta.campaign.leads) || 0, spend: Number(nd.meta.campaign.spend) || 0, endpoint: String(nd.meta.campaign.endpoint || '').slice(0, 300) } } : null }));
  const ids = new Set(nodes.map((x) => x.id));
  const edges = (Array.isArray(f.edges) ? f.edges : []).slice(0, 120).map((e) => ({ from: String(e.from || ''), to: String(e.to || ''), port: Math.max(0, Math.min(19, parseInt(e.port, 10) || 0)) })).filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
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
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const j = await graph('act_' + c.account + '/campaigns', { fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,insights.date_preset(last_' + (days <= 7 ? '7d' : days <= 30 ? '30d' : '90d') + '){impressions,reach,clicks,spend,cpc,cpm,ctr,actions,cost_per_action_type}', limit: 100 }, c.token);
    const out = (j.data || []).map((k) => { const ins = (k.insights && k.insights.data && k.insights.data[0]) || {}; const act = (t) => { const a = (ins.actions || []).find((x) => x.action_type === t); return a ? Number(a.value) : 0; };
      return { id: k.id, name: k.name, status: k.effective_status || k.status, objective: k.objective, daily_budget: k.daily_budget ? Number(k.daily_budget) / 100 : null, lifetime_budget: k.lifetime_budget ? Number(k.lifetime_budget) / 100 : null, start: k.start_time, stop: k.stop_time,
        impressions: Number(ins.impressions || 0), reach: Number(ins.reach || 0), clicks: Number(ins.clicks || 0), spend: Number(ins.spend || 0), cpc: ins.cpc != null ? Number(ins.cpc) : null, cpm: ins.cpm != null ? Number(ins.cpm) : null, ctr: ins.ctr != null ? Number(ins.ctr) : null, link_clicks: act('link_click'), leads: act('lead') || act('onsite_conversion.lead_grouped'), landing_views: act('landing_page_view') }; });
    res.json({ days, campaigns: out });
  } catch (err) { res.status(400).json({ error: err.message }); } });
// Detail kampaně: sady + reklamy s koncovým bodem (odkaz na stránku / lead formulář) a statistikami
router.get('/meta/campaigns/:id', async (req, res, next) => {
  try { const c = await metaCfg(req); if (!c.token || !c.account) return res.status(400).json({ error: 'Meta Ads nejsou napojené.' });
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30)); const preset = 'last_' + (days <= 7 ? '7d' : days <= 30 ? '30d' : '90d');
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
  try { const formId = String(req.params.formId || '').replace(/[^0-9]/g, ''); const days = Math.max(1, Math.min(3650, parseInt(req.query.days, 10) || 30)); const ads = String(req.query.ads || '').split(',').map((x) => x.replace(/[^0-9]/g, '')).filter(Boolean);
    const or = []; if (ads.length && req.query.scope !== 'form') or.push({ meta_ad_id: { in: ads } }); if (formId) or.push({ meta_form_id: formId }); if (!or.length) return res.json({ total: 0, direct: 0, today: 0 });
    const since = new Date(Date.now() - days * 86400000); const where = { OR: or, created_at: { gte: since } }; const day0 = new Date(); day0.setHours(0, 0, 0, 0);
    const [total, today, rows] = await Promise.all([prisma.compounderLead.count({ where }), prisma.compounderLead.count({ where: { OR: or, created_at: { gte: day0 } } }), prisma.compounderLead.findMany({ where, select: { activity_log: true } })]);
    const direct = rows.filter((r) => /napřímo/.test(String(r.activity_log || '').split('\n')[0])).length;
    res.json({ total, direct, today, days }); } catch (err) { next(err); } });
// Rozdělení leadů formuláře mezi obchodníky za období (pro uzel Rozdělení): counts['i:<person_id>'|'e:<rep_id>'] = počet.
router.get('/meta/forms/:formId/split-stats', async (req, res, next) => {
  try { const formId = String(req.params.formId || '').replace(/[^0-9]/g, ''); const days = Math.max(1, Math.min(3650, parseInt(req.query.days, 10) || 30)); const ads = String(req.query.ads || '').split(',').map((x) => x.replace(/[^0-9]/g, '')).filter(Boolean);
    const or = []; if (ads.length && req.query.scope !== 'form') or.push({ meta_ad_id: { in: ads } }); if (formId) or.push({ meta_form_id: formId }); if (!or.length) return res.json({ counts: {}, unassigned: 0 });
    const rows = await prisma.compounderLead.findMany({ where: { OR: or, created_at: { gte: new Date(Date.now() - days * 86400000) } }, select: { owner_person_id: true, external_rep_id: true } });
    const counts = {}; let unassigned = 0; rows.forEach((r) => { const k = r.owner_person_id ? 'i:' + r.owner_person_id : (r.external_rep_id ? 'e:' + r.external_rep_id : null); if (!k) { unassigned++; return; } counts[k] = (counts[k] || 0) + 1; });
    res.json({ counts, unassigned, total: rows.length, days }); } catch (err) { next(err); } });
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
    res.json({ total, in_period: rows.length, scope: (ads.length && req.query.scope !== 'form') ? 'ads' : 'form', by_status: by, status_labels: CMP_STATUS, leads: rows.map((r) => ({ id: r.id, name: r.name || [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || r.phone || '—', company: r.company, city: r.city, email: r.email, phone: r.phone, status: r.status || 'new', status_label: CMP_STATUS[r.status || 'new'] || r.status, hot: !!r.is_hot, test: !!r.is_test, created_at: r.created_at, last_called_at: r.last_called_at, owner: r.owner_person_id ? (pname[r.owner_person_id] || ('#' + r.owner_person_id)) : (r.external_rep_id ? (reps[r.external_rep_id] || ('externí #' + r.external_rep_id)) : ''), specialist_opened: !!r.ai_specialist_opened_at, schuzka_opened: !!r.schuzka_opened_at, ad_id: r.meta_ad_id, lead_id: r.meta_lead_id, via: (function () { const first = String(r.activity_log || '').split('\n')[0]; if (/napřímo/.test(first)) return 'napřímo'; if (/Lead přijat z FB|FB reklam/i.test(first) || r.meta_form_id || r.meta_lead_id || r.source === 'facebook_ads') return 'Make / webhook'; return 'ručně'; })(), notes: r.notes ? String(r.notes).slice(0, 200) : '' })) });
  } catch (err) { next(err); } });

// ── Leady z Facebooku napřímo (bez Make.com): stav oprávnění, stránky + formuláře, nastavení pollingu, ruční stažení ──
const leadsSync = require('../services/ads/meta-leads-sync');
router.get('/meta/leads-sync', async (req, res) => {
  try { const c = await leadsSync.cfg(); let perms = null, pages = null, err = null; try { perms = await leadsSync.permissions(); pages = await leadsSync.pages(true); } catch (e) { err = e.message; }
    const oauth = await leadsSync.oauthStatus(); const webhookUrl = 'https://app.holyos.cz/api/compounder/fb-webhook'; res.json({ oauth, enabled: c.enabled !== false, forms_filter: c.forms || [], interval_min: Number(c.interval_min) || 1, since: c.since || null, pages_filter: c.pages || [], last_run: c.last_run || null, last_result: c.last_result || null, permissions: perms, pages, error: err, webhook: { url: webhookUrl, verify_token: process.env.META_LEAD_VERIFY_TOKEN || 'holyos-meta-verify', app_secret: !!process.env.META_APP_SECRET }, env_page_token: !!process.env.META_PAGE_ACCESS_TOKEN }); } catch (err) { res.status(400).json({ error: err.message }); } });
router.put('/meta/leads-sync', express.json({ limit: '20kb' }), async (req, res, next) => {
  try { const c = await leadsSync.cfg(); const b = req.body || {}; if (b.enabled != null) c.enabled = !!b.enabled; if (b.interval_min != null) c.interval_min = Math.max(1, Math.min(1440, parseInt(b.interval_min, 10) || 1)); if (b.since !== undefined) c.since = b.since ? new Date(b.since).toISOString() : null; if (Array.isArray(b.pages)) c.pages = b.pages.map(String).filter(Boolean); if (Array.isArray(b.forms)) c.forms = b.forms.map(String).filter(Boolean); if (b.form_names && typeof b.form_names === 'object') c.form_names = b.form_names; await leadsSync.saveCfg(c, req.user && req.user.id); res.json({ ok: true }); } catch (err) { next(err); } });
// Pracovní sada pro editor funelu: vybrané stránky + formuláře (s počtem leadů v HolyOS za období) – bez volání Mety.
router.get('/meta/working-set', async (req, res, next) => { try { const c = await leadsSync.cfg(); const { getSetting } = require('../services/settings'); const m = (await getSetting('ads_center.meta', { type: 'json', defaultValue: {} })) || {}; const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 30)); const since = new Date(Date.now() - days * 86400000); const formIds = (c.forms || []).map(String); const names = c.form_names || {}; const counts = {}; if (formIds.length) { const g = await prisma.compounderLead.groupBy({ by: ['meta_form_id'], where: { meta_form_id: { in: formIds }, created_at: { gte: since } }, _count: { _all: true } }); g.forEach((x) => { counts[x.meta_form_id] = x._count._all; }); } res.json({ pages: (m.pages || []).filter((p) => !(c.pages || []).length || (c.pages || []).map(String).includes(String(p.id))).map((p) => ({ id: p.id, name: p.name })), forms: formIds.map((id) => ({ id, name: (names[id] && names[id].name) || ('formulář ' + id), page: (names[id] && names[id].page) || '', leads: counts[id] || 0 })), days }); } catch (err) { next(err); } });
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
      await prisma.compounderLead.update({ where: { id: r.id }, data: { name: (name || r.name || 'FB lead').slice(0, 255), first_name: first ? first.slice(0, 120) : undefined, last_name: last ? last.slice(0, 120) : undefined, email: email ? email.slice(0, 255) : undefined, phone: phone ? phone.slice(0, 40) : undefined, company: f.company ? String(f.company).slice(0, 200) : undefined, city: f.city ? String(f.city).slice(0, 120) : undefined } }); fixed++; }
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
async function channelsView() {
  const { getSetting } = require('../services/settings');
  const saved = (await getSetting(CHANNELS_KEY, { type: 'json', defaultValue: {} })) || {};
  let graphReady = false; try { const g = require('../services/ms-graph-client'); graphReady = !!(g.isConfigured && g.isConfigured()); } catch (_) { /* bez Graphu */ }
  const smtpReady = !!process.env.SMTP_HOST;
  const seen = new Set(); const senders = [];
  MAIL_SENDERS.forEach((d) => { const raw = process.env[d.env] || d.fallback || ''; if (!raw) return; const p = parseAddr(raw); if (!p.address || seen.has(p.address.toLowerCase())) { if (p.address) { const ex = senders.find((x) => x.address.toLowerCase() === p.address.toLowerCase()); if (ex) ex.use += ', ' + d.use; } return; } seen.add(p.address.toLowerCase()); senders.push({ address: p.address, name: (d.nameEnv && process.env[d.nameEnv]) || p.name || '', use: d.use, env: d.env, via: graphReady ? 'graph' : (smtpReady ? 'smtp' : 'none') }); });
  (Array.isArray(saved.extra_senders) ? saved.extra_senders : []).forEach((a) => { const p = parseAddr(a); if (p.address && !seen.has(p.address.toLowerCase())) { seen.add(p.address.toLowerCase()); senders.push({ address: p.address, name: p.name, use: 'vlastní (přidáno v nastavení)', env: '', custom: true, via: graphReady ? 'graph' : (smtpReady ? 'smtp' : 'none') }); } });
  let sms = { provider: 'twilio', gosms_channel: '', twilio_sms_from: '', gosms_ready: false, twilio_ready: false };
  try { sms = await require('../services/voice/sms').getSmsConfigView(); } catch (_) { /* bez SMS služby */ }
  // Twilio čísla linek (volané číslo → linka) + výchozí odchozí číslo hlasového agenta
  let lineNumbers = {}; try { let m = await getSetting('voice.line_numbers'); if (typeof m === 'string') m = JSON.parse(m); if (m && typeof m === 'object') lineNumbers = m; } catch (_) { /* není */ }
  const smsFrom = sms.provider === 'gosms' ? (sms.gosms_channel ? 'GoSMS kanál #' + sms.gosms_channel : '') : sms.twilio_sms_from;
  return {
    email: { graph_ready: graphReady, smtp_ready: smtpReady, senders, default_from: saved.email_from || (senders[0] && senders[0].address) || '' },
    sms: { provider: sms.provider, ready: sms.provider === 'gosms' ? sms.gosms_ready : sms.twilio_ready, from: smsFrom, from_detail: sms.provider === 'gosms' ? 'GoSMS.cz – odesílatel je nastaven jako kanál v portálu GoSMS (typicky „Pradlomaty").' : (String(sms.twilio_sms_from || '').startsWith('MG') ? 'Twilio Messaging Service (' + sms.twilio_sms_from + ')' : 'Twilio číslo / alfanumerický odesílatel'), voice_default_from: process.env.VOICE_DEFAULT_FROM || '', line_numbers: Object.entries(lineNumbers).map(([num, line]) => ({ number: num, line })), settings_url: '/modules/servis/index.html#infolinka' },
  };
}
router.get('/channels', async (req, res, next) => { try { res.json(await channelsView()); } catch (err) { next(err); } });
router.put('/channels', express.json({ limit: '20kb' }), async (req, res, next) => {
  try { const { getSetting, setSetting } = require('../services/settings'); const cur = (await getSetting(CHANNELS_KEY, { type: 'json', defaultValue: {} })) || {}; const b = req.body || {};
    const v = { email_from: b.email_from != null ? String(b.email_from).trim() : (cur.email_from || ''), extra_senders: Array.isArray(b.extra_senders) ? b.extra_senders.map((s) => String(s).trim()).filter((s) => /@/.test(s)).slice(0, 20) : (cur.extra_senders || []) };
    await setSetting(CHANNELS_KEY, v, { type: 'json', description: 'Centrum reklamy – komunikační kanály (výchozí e-mailový odesílatel, vlastní schránky)', scope: 'marketing', userId: req.user && req.user.id });
    res.json({ ok: true }); } catch (err) { next(err); } });
// Testovací odeslání – ověří, že Graph/SMTP schránku skutečně pustí (odešle krátký e-mail / SMS na zadanou adresu / číslo).
router.post('/channels/test-email', express.json({ limit: '10kb' }), async (req, res) => {
  try { const b = req.body || {}; const to = String(b.to || (req.user && req.user.email) || '').trim(); if (!to) return res.status(400).json({ error: 'Chybí adresa příjemce' });
    const r = await require('../services/email').sendMail({ to, from: String(b.from || '').trim() || undefined, subject: 'HolyOS – test odesílatele', body: 'Testovací e-mail z Centra reklamy. Odesílatel: ' + (b.from || 'výchozí') + '.', link: 'https://app.holyos.cz/modules/centrum-reklamy/index.html#settings', linkLabel: 'Centrum reklamy' });
    if (!r.sent) return res.status(400).json({ error: r.error || r.skipped || 'neodesláno' }); res.json({ ok: true, via: r.via, from: r.from || b.from || '' }); } catch (err) { res.status(400).json({ error: err.message }); } });
router.post('/channels/test-sms', express.json({ limit: '10kb' }), async (req, res) => {
  try { const to = String((req.body || {}).to || '').trim(); if (!to) return res.status(400).json({ error: 'Chybí číslo příjemce' });
    const id = await require('../services/voice/sms').sendSms(to, 'HolyOS – test SMS brány z Centra reklamy.', { source: 'ads_center_test' }); res.json({ ok: true, id }); } catch (err) { res.status(400).json({ error: err.message }); } });

module.exports = router;
