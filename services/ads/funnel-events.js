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
      else if (type === 'open' && nd.kind === 'email' && (nd.variant || 'specialist') === opts.variant) out.push({ funnel_id: f.id, node_id: nd.id });
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
  const rows = await prisma.compounderEvent.findMany({ where: { event: { in: ['funnel_sms', 'funnel_email', 'funnel_landing', 'funnel_open'] }, path: { startsWith: '/funnel/' + funnelId + '/' }, created_at: { gte: since } }, select: { event: true, path: true, props: true, created_at: true }, orderBy: { created_at: 'asc' } });
  const f = (await funnels()).find((x) => x.id === funnelId); const act = {}; const kinds = {}; (f && f.nodes || []).forEach((nd) => { act[nd.id] = nd.activated_at ? new Date(nd.activated_at).getTime() : 0; kinds[nd.id] = nd.kind; });
  const per = {}; const opened = {}; const landingByLead = {}; // landingByLead[lead] = [{t, channel}]
  rows.forEach((r) => { const nodeId = r.path.split('/')[3]; if (!nodeId) return; const lid = r.props && r.props.lead_id; if (r.event === 'funnel_landing' && lid) (landingByLead[lid] || (landingByLead[lid] = [])).push({ t: r.created_at.getTime(), channel: r.props.channel || '' });
    if (act[nodeId] && r.created_at.getTime() < act[nodeId]) return;
    if (r.event === 'funnel_open') { (opened[nodeId] || (opened[nodeId] = new Set())).add(lid); return; }
    const p = per[nodeId] || (per[nodeId] = { events: 0, leads: new Map(), type: r.event.replace('funnel_', '') }); p.events++; if (lid && !p.leads.has(lid)) p.leads.set(lid, r.created_at.getTime()); });
  // doručení SMS (SmsLog.delivered) pro leady akčních SMS uzlů
  const smsLeads = new Set(); Object.keys(per).forEach((k) => { if (kinds[k] === 'sms') per[k].leads.forEach((t, lid) => smsLeads.add(lid)); });
  let delivered = new Set(); if (smsLeads.size && prisma.smsLog) { try { const dl = await prisma.smsLog.findMany({ where: { lead_id: { in: [...smsLeads] }, delivered: true, created_at: { gte: since } }, select: { lead_id: true } }); delivered = new Set(dl.map((x) => x.lead_id)); } catch (e) { /* bez logu */ } }
  const out = {}; Object.keys(per).forEach((k) => { const p = per[k]; const o = { events: p.events, leads: p.leads.size, type: p.type };
    if (kinds[k] === 'sms' || kinds[k] === 'email') { const ch = kinds[k]; let clicked = 0, deliv = 0, op = 0; p.leads.forEach((t, lid) => { if ((landingByLead[lid] || []).some((x) => x.t >= t - 60000 && (!x.channel || x.channel === ch))) clicked++; if (delivered.has(lid)) deliv++; if (opened[k] && opened[k].has(lid)) op++; }); o.clicked = clicked; o.delivered = kinds[k] === 'sms' ? deliv : undefined; o.opened = kinds[k] === 'email' ? op : undefined; o.noreact = p.leads.size - clicked; }
    out[k] = o; });
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
  const rows = await prisma.compounderEvent.findMany({ where: { event: { in: ['funnel_sms', 'funnel_email', 'funnel_landing', 'funnel_open'] }, path: { startsWith: '/funnel/' + funnelId + '/' }, created_at: { gte: since } }, select: { path: true, props: true, event: true, created_at: true }, orderBy: { created_at: 'asc' } });
  const first = {}; const landingByLead = {}; const openedBy = {}; // landingByLead[lead] = [{t, channel}], openedBy[nodeId] = Set(lead)
  rows.forEach((r) => { const nodeId = r.path.split('/')[3]; const lid = r.props && r.props.lead_id; if (!nodeId || !lid) return;
    if (r.event === 'funnel_landing') (landingByLead[lid] || (landingByLead[lid] = [])).push({ t: r.created_at.getTime(), channel: r.props.channel || '' });
    if (act[nodeId] && r.created_at.getTime() < act[nodeId]) return;
    if (r.event === 'funnel_open') { (openedBy[nodeId] || (openedBy[nodeId] = new Set())).add(Number(lid)); return; }
    (first[nodeId] || (first[nodeId] = {}))[lid] = first[nodeId][lid] || r.created_at; });
  // doručení SMS (SmsLog.delivered) pro leady SMS uzlů
  let delivered = new Set(); try { const smsIds = []; nodes.forEach((nd) => { if (nd.kind === 'sms') Object.keys(first[nd.id] || {}).forEach((lid) => smsIds.push(Number(lid))); }); if (smsIds.length && prisma.smsLog) { const dl = await prisma.smsLog.findMany({ where: { lead_id: { in: smsIds }, delivered: true, created_at: { gte: since } }, select: { lead_id: true } }); delivered = new Set(dl.map((x) => x.lead_id)); } } catch (e) { /* bez logu */ }
  // filtr podle tečky (cíle) SMS / e-mailového uzlu: 1 = odesláno, 2 = doručeno (SMS) / otevřel (e-mail), 3 = klikl na odkaz, 4 = bez reakce. Vrací { ok, tB }.
  function goalPass(A, port, lid, tA) { const t0 = new Date(tA).getTime(); const ch = A.kind; const click = (landingByLead[lid] || []).filter((x) => x.t >= t0 - 60000 && (!x.channel || x.channel === ch)).sort((x, y) => x.t - y.t)[0];
    if (!port || port === 1) return { ok: true, tB: null };
    if (port === 2) return ch === 'sms' ? { ok: delivered.has(lid), tB: null } : { ok: !!(openedBy[A.id] && openedBy[A.id].has(lid)), tB: null };
    if (port === 3) return { ok: !!click, tB: click ? new Date(click.t) : null };
    if (port === 4) return { ok: !click, tB: null };
    return { ok: true, tB: null }; }
  // 2) leady formulářů (DB) – cache per form
  const formCache = {};
  async function formLeads(nd) { const fid = nd.form && nd.form.form_id; if (!fid) return []; if (formCache[fid]) return formCache[fid]; const ads = (nd.form.ad_ids || []).map(String).filter(Boolean); const or = ads.length ? [{ meta_ad_id: { in: ads } }] : [{ meta_form_id: String(fid) }]; const L = await prisma.compounderLead.findMany({ where: { OR: or, created_at: { gte: since } }, select: { id: true, created_at: true, owner_person_id: true, external_rep_id: true } }); formCache[fid] = L; return L; }
  function upstreamFormNode(nd, depth) { if (!nd || depth > 10) return null; if (nd.kind === 'leadform') return nd; const e = edges.find((x) => x.to === nd.id); return e ? upstreamFormNode(byId[e.from], (depth || 0) + 1) : null; }
  // množina leadů uzlu (+ port u rozdělení): Map lead_id → čas
  async function setOf(nd, port) {
    const m = new Map(); if (!nd) return m;
    if (nd.kind === 'leadform') { (await formLeads(nd)).forEach((L) => m.set(L.id, L.created_at)); return m; }
    if (nd.kind === 'split') { const fn = upstreamFormNode(nd, 0); if (!fn) return m; // port < 10 = jedna větev; port 10+j = sloučený výstup (sjednocení větví) → klíče všech sloučených větví
      const P = port || 0; let keys = null; if (P >= 10) { const mg = (nd.merges || [])[P - 10]; keys = new Set((mg && mg.ports ? mg.ports : []).map((pi) => ((nd.branches || [])[pi] || {}).key).filter(Boolean)); } else { const br = (nd.branches || [])[P]; if (br && br.key) keys = new Set([br.key]); }
      const L = await formLeads(fn); L.forEach((x) => { if (keys) { const k = x.owner_person_id ? 'i:' + x.owner_person_id : (x.external_rep_id ? 'e:' + x.external_rep_id : ''); if (!keys.has(k)) return; } m.set(x.id, x.created_at); }); return m; }
    if (['sms', 'email', 'landing'].includes(nd.kind)) { Object.keys(first[nd.id] || {}).forEach((lid) => m.set(Number(lid), first[nd.id][lid])); return m; }
    return m;
  }
  const out = {};
  for (const e of edges) {
    const A = byId[e.from], B = byId[e.to]; if (!A || !B) continue; if (['start', 'note', 'result', 'goals', 'step'].includes(A.kind) || ['note', 'result', 'goals', 'step'].includes(B.kind)) continue;
    // Význam čísla na spojce = ke kolika leadům touto cestou informace prošla:
    //  - do SMS / e-mailu: leady z větve, kterým TENTO uzel zprávu poslal (průnik A ∩ B)
    //  - z SMS / e-mailu dál (na stránku apod.): kolika leadům zpráva z A odešla (od vytvoření spojky) – otevření je číslo v uzlu stránky
    //  - z formuláře / rozdělení: leady dané větve
    const sa = await setOf(A, e.port || 0); const ec = e.created_at ? new Date(e.created_at).getTime() : 0; const eventA = ['sms', 'email', 'landing'].includes(A.kind); const actionB = ['sms', 'email'].includes(B.kind);
    const sb = actionB ? await setOf(B, 0) : null; const list = [];
    const actionA = ['sms', 'email'].includes(A.kind);
    sa.forEach((tA, lid) => { if (eventA && ec && new Date(tA).getTime() < ec) return; let tG = null; if (actionA) { const g = goalPass(A, e.port || 0, Number(lid), tA); if (!g.ok) return; tG = g.tB; } if (actionB) { const tB = sb.get(lid); if (!tB) return; list.push({ lead_id: lid, tA, tB }); } else list.push({ lead_id: lid, tA, tB: tG }); });
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

// Log odeslání uzlu SMS/e-mail: co, komu, kdy odešlo + doručeno / otevřeno / kliknuto (pro kontrolu přímo z uzlu).
async function nodeLog(funnelId, nodeId, since) {
  const path = '/funnel/' + funnelId + '/' + nodeId;
  const sent = await prisma.compounderEvent.findMany({ where: { path, event: { in: ['funnel_sms', 'funnel_email'] }, created_at: { gte: since } }, orderBy: { created_at: 'desc' }, take: 500 });
  const ids = Array.from(new Set(sent.map((r) => Number(r.props && r.props.lead_id)).filter(Boolean)));
  if (!ids.length) return [];
  const leads = await prisma.compounderLead.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, phone: true, status: true } });
  const byId = {}; leads.forEach((l) => { byId[l.id] = l; });
  const sids = ids.map((x) => 'lead:' + x);
  const after = await prisma.compounderEvent.findMany({ where: { sid: { in: sids }, event: { in: ['funnel_open', 'funnel_landing'] }, created_at: { gte: since } }, select: { sid: true, event: true, created_at: true, props: true } });
  const smsLogs = await prisma.smsLog.findMany({ where: { lead_id: { in: ids }, created_at: { gte: new Date(since.getTime() - 86400000) } }, select: { lead_id: true, status: true, delivered: true, error: true, message_id: true, created_at: true } });
  return sent.map((r) => {
    const lid = Number(r.props && r.props.lead_id); const L = byId[lid] || {}; const ch = r.event === 'funnel_sms' ? 'sms' : 'email'; const t = r.created_at.getTime();
    const opened = after.filter((x) => x.sid === 'lead:' + lid && x.event === 'funnel_open' && x.created_at.getTime() >= t).map((x) => x.created_at).sort()[0] || null;
    const clicked = after.filter((x) => x.sid === 'lead:' + lid && x.event === 'funnel_landing' && (x.props && x.props.channel) === ch && x.created_at.getTime() >= t).map((x) => x.created_at).sort()[0] || null;
    let sl = null; if (ch === 'sms') { const cands = smsLogs.filter((x) => x.lead_id === lid && ((r.props.msg_id && x.message_id === r.props.msg_id) || Math.abs(x.created_at.getTime() - t) < 300000)); sl = cands[0] || null; }
    return { lead_id: lid, name: L.name, email: L.email, phone: L.phone, lead_status: L.status, channel: ch, sent_at: r.created_at, to: r.props.to || (ch === 'sms' ? L.phone : L.email) || '', subject: r.props.subject || '', text: r.props.text || '', from: r.props.from || '', link: r.props.link || '', backfill: !!r.props.backfill, delivery: sl ? (sl.delivered ? 'doručeno' : (sl.status || 'odesláno')) : (ch === 'sms' ? '—' : 'odesláno'), delivery_error: sl && sl.error ? sl.error : '', opened_at: ch === 'email' ? opened : null, clicked_at: clicked };
  });
}

module.exports = { nodeLog, record, stats, invalidate, matchNodes, backfill, edgeFlows };
