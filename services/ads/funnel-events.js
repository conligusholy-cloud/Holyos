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

// Průchody spojkami – pro KAŽDOU hranu A→B: leady, které jsou v množině A (u Rozdělení jen daná větev) i v množině B.
// Množiny: formulář = leady z formuláře (DB), rozdělení = leady formuláře podle obchodníka větve, SMS/e-mail/stránka = události funelu.
// U cílové události se hlídá pořadí (B po A) a čas vytvoření spojky. Vrací { 'A>B': { leads, list:[{lead_id,tA,tB}] } }.
async function edgeFlows(funnelId, since, withList) {
  const f = (await funnels()).find((x) => x.id === funnelId); if (!f) return {};
  const nodes = f.nodes || [], edges = f.edges || []; const byId = {}; nodes.forEach((nd) => { byId[nd.id] = nd; });
  const act = {}; nodes.forEach((nd) => { act[nd.id] = nd.activated_at ? new Date(nd.activated_at).getTime() : 0; });
  // 1) události → first[nodeId][leadId] = čas
  const rows = await prisma.compounderEvent.findMany({ where: { event: { in: ['funnel_sms', 'funnel_email', 'funnel_landing'] }, path: { startsWith: '/funnel/' + funnelId + '/' }, created_at: { gte: since } }, select: { path: true, props: true, created_at: true }, orderBy: { created_at: 'asc' } });
  const first = {}; rows.forEach((r) => { const nodeId = r.path.split('/')[3]; const lid = r.props && r.props.lead_id; if (!nodeId || !lid) return; if (act[nodeId] && r.created_at.getTime() < act[nodeId]) return; (first[nodeId] || (first[nodeId] = {}))[lid] = first[nodeId][lid] || r.created_at; });
  // 2) leady formulářů (DB) – cache per form
  const formCache = {};
  async function formLeads(nd) { const fid = nd.form && nd.form.form_id; if (!fid) return []; if (formCache[fid]) return formCache[fid]; const ads = (nd.form.ad_ids || []).map(String).filter(Boolean); const or = ads.length ? [{ meta_ad_id: { in: ads } }] : [{ meta_form_id: String(fid) }]; const L = await prisma.compounderLead.findMany({ where: { OR: or, created_at: { gte: since } }, select: { id: true, created_at: true, owner_person_id: true, external_rep_id: true } }); formCache[fid] = L; return L; }
  function upstreamFormNode(nd, depth) { if (!nd || depth > 10) return null; if (nd.kind === 'leadform') return nd; const e = edges.find((x) => x.to === nd.id); return e ? upstreamFormNode(byId[e.from], (depth || 0) + 1) : null; }
  // množina leadů uzlu (+ port u rozdělení): Map lead_id → čas
  async function setOf(nd, port) {
    const m = new Map(); if (!nd) return m;
    if (nd.kind === 'leadform') { (await formLeads(nd)).forEach((L) => m.set(L.id, L.created_at)); return m; }
    if (nd.kind === 'split') { const fn = upstreamFormNode(nd, 0); if (!fn) return m; const br = (nd.branches || [])[port || 0]; const L = await formLeads(fn); L.forEach((x) => { if (br && br.key) { const k = x.owner_person_id ? 'i:' + x.owner_person_id : (x.external_rep_id ? 'e:' + x.external_rep_id : ''); if (k !== br.key) return; } m.set(x.id, x.created_at); }); return m; }
    if (['sms', 'email', 'landing'].includes(nd.kind)) { Object.keys(first[nd.id] || {}).forEach((lid) => m.set(Number(lid), first[nd.id][lid])); return m; }
    return m;
  }
  const out = {};
  for (const e of edges) {
    const A = byId[e.from], B = byId[e.to]; if (!A || !B) continue; if (['start', 'note', 'result', 'goals', 'step'].includes(A.kind) || ['note', 'result', 'goals', 'step'].includes(B.kind)) continue;
    const sa = await setOf(A, e.port || 0), sb = await setOf(B, 0); const ec = e.created_at ? new Date(e.created_at).getTime() : 0; const eventB = ['sms', 'email', 'landing'].includes(B.kind);
    const list = []; sa.forEach((tA, lid) => { const tB = sb.get(lid); if (!tB) return; if (eventB) { if (new Date(tB).getTime() < new Date(tA).getTime() - 60000) return; if (ec && new Date(tB).getTime() < ec) return; } list.push({ lead_id: lid, tA, tB }); });
    out[e.from + '>' + e.to + (e.port ? '#' + e.port : '')] = { leads: list.length, list: withList ? list : undefined };
  }
  return out;
}


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

module.exports = { record, stats, invalidate, matchNodes, backfill, edgeFlows };
