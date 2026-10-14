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
  try { await backfill(funnelId); } catch (e) { console.warn('[funnel-events] backfill', e.message); }
  const rows = await prisma.compounderEvent.findMany({ where: { event: { in: ['funnel_sms', 'funnel_email', 'funnel_landing'] }, path: { startsWith: '/funnel/' + funnelId + '/' }, created_at: { gte: since } }, select: { event: true, path: true, props: true, created_at: true } });
  const f = (await funnels()).find((x) => x.id === funnelId); const act = {}; (f && f.nodes || []).forEach((nd) => { act[nd.id] = nd.activated_at ? new Date(nd.activated_at).getTime() : 0; });
  const per = {};
  rows.forEach((r) => { const nodeId = r.path.split('/')[3]; if (!nodeId) return; if (act[nodeId] && r.created_at.getTime() < act[nodeId]) return; const p = per[nodeId] || (per[nodeId] = { events: 0, leads: new Set(), type: r.event.replace('funnel_', '') }); p.events++; if (r.props && r.props.lead_id) p.leads.add(r.props.lead_id); });
  const out = {}; Object.keys(per).forEach((k) => { out[k] = { events: per[k].events, leads: per[k].leads.size, type: per[k].type }; });
  return out;
}

// Průchody spojkami: pro hranu A→B (oba uzly sledované) = leady, které mají událost v A a poté v B
// (a po vytvoření spojky, pokud má created_at). Vrací { 'A>B': { leads, list:[{lead_id, tA, tB}] } }.
async function edgeFlows(funnelId, since, withList) {
  const f = (await funnels()).find((x) => x.id === funnelId); if (!f) return {};
  const tracked = new Set((f.nodes || []).filter((nd) => ['sms', 'email', 'landing'].includes(nd.kind)).map((nd) => nd.id));
  const edges = (f.edges || []).filter((e) => tracked.has(e.from) && tracked.has(e.to)); if (!edges.length) return {};
  const act = {}; (f.nodes || []).forEach((nd) => { act[nd.id] = nd.activated_at ? new Date(nd.activated_at).getTime() : 0; });
  const rows = await prisma.compounderEvent.findMany({ where: { event: { in: ['funnel_sms', 'funnel_email', 'funnel_landing'] }, path: { startsWith: '/funnel/' + funnelId + '/' }, created_at: { gte: since } }, select: { path: true, props: true, created_at: true }, orderBy: { created_at: 'asc' } });
  const first = {}; // first[nodeId][leadId] = první čas události
  rows.forEach((r) => { const nodeId = r.path.split('/')[3]; const lid = r.props && r.props.lead_id; if (!nodeId || !lid) return; if (act[nodeId] && r.created_at.getTime() < act[nodeId]) return; (first[nodeId] || (first[nodeId] = {}))[lid] = first[nodeId][lid] || r.created_at; });
  const out = {};
  edges.forEach((e) => { const A = first[e.from] || {}, B = first[e.to] || {}; const ec = e.created_at ? new Date(e.created_at).getTime() : 0; const list = []; Object.keys(A).forEach((lid) => { const tA = A[lid], tB = B[lid]; if (!tB) return; if (tB.getTime() < tA.getTime() - 60000) return; if (ec && tB.getTime() < ec) return; list.push({ lead_id: Number(lid), tA, tB }); }); out[e.from + '>' + e.to] = { leads: list.length, list: withList ? list : undefined }; });
  return out;
}

module.exports.edgeFlows = edgeFlows;

// Zpětné dopočítání historie pro uzly, které existovaly před zavedením událostí: z polí leadu
// (ai_specialist_sms_sent_at, schuzka_sms_sent_at, *_email_sent_at, *_opened_at) vytvoří události
// s původním časem. Uzel s activated_at dostane jen události po aktivaci; bez activated_at celou historii.
// Spouští se jednou per funel (příznak backfilled_at ve funelu); duplicitám brání kontrola existujících událostí.
async function backfill(funnelId) {
  const { setSetting } = require('../settings');
  const list = await funnels(); const f = list.find((x) => x.id === funnelId); if (!f || f.backfilled_at) return { skipped: true };
  const nodes = (f.nodes || []).filter((nd) => ['sms', 'email', 'landing'].includes(nd.kind));
  if (!nodes.length) { f.backfilled_at = new Date().toISOString(); await setSetting(FUNNELS_KEY, list, { type: 'json', description: 'Centrum reklamy – definice funelů', scope: 'marketing' }); invalidate(); return { created: 0 }; }
  const leads = await prisma.compounderLead.findMany({ where: { OR: [{ ai_specialist_sms_sent_at: { not: null } }, { schuzka_sms_sent_at: { not: null } }, { ai_specialist_email_sent_at: { not: null } }, { schuzka_email_sent_at: { not: null } }, { ai_specialist_opened_at: { not: null } }, { schuzka_opened_at: { not: null } }] }, select: { id: true, ai_specialist_sms_sent_at: true, schuzka_sms_sent_at: true, ai_specialist_email_sent_at: true, schuzka_email_sent_at: true, ai_specialist_opened_at: true, schuzka_opened_at: true, ai_specialist_sms_channel: true } });
  const existing = new Set((await prisma.compounderEvent.findMany({ where: { path: { startsWith: '/funnel/' + funnelId + '/' } }, select: { path: true, props: true } })).map((e) => e.path + '#' + (e.props && e.props.lead_id)));
  const rows = [];
  for (const nd of nodes) {
    const act = nd.activated_at ? new Date(nd.activated_at).getTime() : 0; const vr = nd.variant || 'specialist';
    for (const L of leads) {
      let ts = null, type = null, channel = null;
      if (nd.kind === 'sms') { ts = vr === 'schuzka' ? L.schuzka_sms_sent_at : L.ai_specialist_sms_sent_at; type = 'sms'; channel = 'sms'; }
      else if (nd.kind === 'email') { ts = vr === 'schuzka' ? L.schuzka_email_sent_at : L.ai_specialist_email_sent_at; type = 'email'; channel = 'email'; }
      else if (nd.kind === 'landing' && !nd.page) { ts = vr === 'schuzka' ? L.schuzka_opened_at : L.ai_specialist_opened_at; type = 'landing'; }
      if (!ts) continue; if (act && new Date(ts).getTime() < act) continue;
      const path = '/funnel/' + funnelId + '/' + nd.id; if (existing.has(path + '#' + L.id)) continue;
      rows.push({ sid: 'lead:' + L.id, event: 'funnel_' + type, path, props: { lead_id: L.id, funnel_id: funnelId, node_id: nd.id, variant: vr, channel, backfill: true }, created_at: new Date(ts) });
    }
  }
  for (let i = 0; i < rows.length; i += 500) await prisma.compounderEvent.createMany({ data: rows.slice(i, i + 500) });
  f.backfilled_at = new Date().toISOString(); await setSetting(FUNNELS_KEY, list, { type: 'json', description: 'Centrum reklamy – definice funelů', scope: 'marketing' }); invalidate();
  console.log('[funnel-events] backfill funel', funnelId, rows.length, 'událostí');
  return { created: rows.length };
}

module.exports = { record, stats, invalidate, matchNodes, backfill };
