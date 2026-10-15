// HolyOS — Centrum reklamy: historie změn stavu leadů (pro analýzu kvality leadů a ziskovosti)
// =============================================================================
// Stavy leadů se mění na desítce míst v kódu, proto se nehákuje každé místo: jednou za minutu se porovná
// aktuální stav všech leadů s posledním známým (AppSetting ads_center.lead_status_map) a každá změna se
// zapíše jako událost 'lead_status' {lead_id, from, to} do CompounderEvent s časem změny (přesnost ~1 min).
// První běh jen uloží výchozí stav (historie před nasazením není k dispozici).
const { prisma } = require('../../config/database');
const { getSetting, setSetting } = require('../settings');

const KEY = 'ads_center.lead_status_map';
let timer = null, running = false;

async function tick() {
  if (running) return; running = true;
  try {
    const rows = await prisma.compounderLead.findMany({ select: { id: true, status: true } });
    const prev = await getSetting(KEY, { type: 'json', defaultValue: null });
    const cur = {}; rows.forEach((r) => { cur[r.id] = r.status || ''; });
    if (prev && typeof prev === 'object') {
      const ev = [];
      rows.forEach((r) => {
        const old = prev[r.id];
        if (old === undefined) ev.push({ sid: 'lead-' + r.id, event: 'lead_status', path: '/lead/' + r.id, props: { lead_id: r.id, from: null, to: r.status || '' } });
        else if (old !== (r.status || '')) ev.push({ sid: 'lead-' + r.id, event: 'lead_status', path: '/lead/' + r.id, props: { lead_id: r.id, from: old, to: r.status || '' } });
      });
      if (ev.length) await prisma.compounderEvent.createMany({ data: ev.slice(0, 2000) });
      if (!ev.length && JSON.stringify(prev).length === JSON.stringify(cur).length && Object.keys(prev).length === rows.length) { running = false; return; }
    }
    await setSetting(KEY, cur, { type: 'json', description: 'Centrum reklamy – poslední známé stavy leadů (detekce změn)', scope: 'marketing' });
  } catch (e) { console.error('[lead-quality]', e.message); }
  running = false;
}
function start() { if (timer) return; timer = setInterval(tick, 60000); setTimeout(tick, 45000); console.log('[lead-quality] sledování změn stavu leadů spuštěno (1× za minutu)'); }
module.exports = { start, tick };
