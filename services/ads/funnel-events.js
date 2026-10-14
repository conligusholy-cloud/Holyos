// HolyOS — Centrum reklamy: události funelu (běh funelu per uzel)
// =============================================================================
// Každé odeslání SMS / e-mailu z automatu a každé otevření sledovaného odkazu se zapíše jako
// CompounderEvent 'funnel_<typ>' s props { funnel_id, node_id, lead_id, variant, channel }.
// Uzel se dohledá z uložených funelů (AppSetting ads_center.funnels): zapnutý uzel daného druhu
// a varianty, aktivovaný před událostí. Čísla u uzlů na plátně se pak počítají JEN z těchto událostí,
// takže nově připojené vlákno začíná na nule a roste s tím, co jím skutečně prošlo.
const { prisma } = require('../../config/database');
const { getSetting } = require('../settings');

const FUNNELS_KEY = 'ads_center.funnels';
let cache = { at: 0, funnels: [] };
async function funnels() { if (Date.now() - cache.at > 30000) { const v = await getSetting(FUNNELS_KEY, { type: 'json', defaultValue: [] }); cache = { at: Date.now(), funnels: Array.isArray(v) ? v : [] }; } return cache.funnels; }
function invalidate() { cache.at = 0; }

// Najde uzly, kterým událost patří. type: 'sms' | 'email' | 'landing'. opts: { variant, pageUrl }
async function matchNodes(type, opts) {
  const out = []; const now = Date.now();
  for (const f of await funnels()) {
    for (const nd of f.nodes || []) {
      if (nd.enabled === false) continue;
      if (nd.activated_at && new Date(nd.activated_at).getTime() > now + 60000) continue;
      if (type === 'sms' && nd.kind === 'sms' && (nd.variant || 'specialist') === opts.variant) out.push({ funnel_id: f.id, node_id: nd.id });
      else if (type === 'email' && nd.kind === 'email' && (nd.variant || 'specialist') === opts.variant) out.push({ funnel_id: f.id, node_id: nd.id });
      else if (type === 'landing' && nd.kind === 'landing') {
        // stránka z Centra reklamy (nd.page) nebo výchozí stránka varianty (nd.variant)
        const byVariant = !nd.page && (nd.variant || 'specialist') === opts.variant;
        const byPage = nd.page && opts.pageKey && nd.page === opts.pageKey;
        if (byVariant || byPage) out.push({ funnel_id: f.id, node_id: nd.id });
      }
    }
  }
  return out;
}

// Zapíše událost pro všechny odpovídající uzly (jedna událost na uzel). Best-effort, nikdy nehází.
async function record(type, leadId, opts) {
  try {
    const nodes = await matchNodes(type, opts || {});
    if (!nodes.length) return 0;
    const ev = 'funnel_' + type;
    await prisma.compounderEvent.createMany({ data: nodes.map((m) => ({ sid: 'lead:' + leadId, event: ev, path: '/funnel/' + m.funnel_id + '/' + m.node_id, props: Object.assign({ lead_id: Number(leadId), funnel_id: m.funnel_id, node_id: m.node_id }, opts || {}) })) });
    return nodes.length;
  } catch (e) { console.warn('[funnel-events] record', e.message); return 0; }
}

// Statistika funelu: per uzel { leads (unikátní), events } jen od aktivace uzlu a v období (since).
async function stats(funnelId, since) {
  const rows = await prisma.compounderEvent.findMany({ where: { event: { in: ['funnel_sms', 'funnel_email', 'funnel_landing'] }, path: { startsWith: '/funnel/' + funnelId + '/' }, created_at: { gte: since } }, select: { event: true, path: true, props: true, created_at: true } });
  const f = (await funnels()).find((x) => x.id === funnelId); const act = {}; (f && f.nodes || []).forEach((nd) => { act[nd.id] = nd.activated_at ? new Date(nd.activated_at).getTime() : 0; });
  const per = {};
  rows.forEach((r) => { const nodeId = r.path.split('/')[3]; if (!nodeId) return; if (act[nodeId] && r.created_at.getTime() < act[nodeId]) return; const p = per[nodeId] || (per[nodeId] = { events: 0, leads: new Set(), type: r.event.replace('funnel_', '') }); p.events++; if (r.props && r.props.lead_id) p.leads.add(r.props.lead_id); });
  const out = {}; Object.keys(per).forEach((k) => { out[k] = { events: per[k].events, leads: per[k].leads.size, type: per[k].type }; });
  return out;
}

module.exports = { record, stats, invalidate, matchNodes };
