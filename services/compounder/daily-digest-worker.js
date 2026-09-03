// =============================================================================
// HolyOS — Compounder: denní hodnocení leadů (23:55) do Velína
// =============================================================================
// Každý den ve 23:55 (Europe/Prague) sestaví hodnocení dnešní aktivity leadů:
//   • kolik leadů bylo aktivních
//   • u každého aktivního: co ho zajímalo nejvíc + kolik času strávil na portálu
//   • hodnocení obchodníků: čí kontakty byly nejaktivnější + nejaktivnější obchodník
// Testovací leady (e-mail @bestseries.cz) se z hodnocení VYJÍMAJÍ.
// Výsledek jde push + zvonek Janovi a Tomášovi (compounder.velin_notify_person_ids).
//
// Startuje z app.js: require('./services/compounder/daily-digest-worker').start();
// Ruční spuštění: require('./services/compounder/daily-digest-worker').runNow().
// Vypnutí: env COMPOUNDER_DIGEST_DISABLED=1.

'use strict';

const { prisma } = require('../../config/database');
const notify = require('./notify');

const TICK_INTERVAL_MS = 60 * 1000;
let _tick = null;
let _lastFired = null; // dayKey — dvojí spuštění v rámci dne zabráníme
let _lastResult = null;

const MARK_H = 23;
const MARK_M = 55;

const PAGE_NAMES = {
  filozofie: 'Filozofie', ekonomika: 'Provozovatel', nabidka: 'Investor', navratnost: 'Distributor',
  milniky: 'Milníky', parametry: 'Parametry', galerie: 'Galerie', pripojky: 'Přípojky',
  pudorysy: 'Půdorysy', distribuce: 'Distribuce', lokalita: 'Lokalita', kontakt: 'Kontakt',
};
function pageName(k) { return PAGE_NAMES[k] || (k || '—'); }

function tzToday() {
  const tz = process.env.VELIN_TZ || 'Europe/Prague';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function startOfToday() {
  return new Date(tzToday() + 'T00:00:00Z');
}
function isTestLead(email) {
  return String(email || '').trim().toLowerCase().endsWith('@bestseries.cz');
}
function topKey(obj) {
  let best = null; let bestN = 0;
  for (const k in obj) { if (obj[k] > bestN) { bestN = obj[k]; best = k; } }
  return best;
}
function fmtMin(ms) {
  const s = Math.round((Number(ms) || 0) / 1000);
  if (s < 60) return s + ' s';
  const m = Math.round(s / 60);
  return m + ' min';
}

// Dnešní aktivita AI specialisty: kolik odešlo/otevřelo/chatovalo + kdo chatoval a co chce.
async function computeAispecToday(since) {
  try {
    const userMsgs = await prisma.aiSpecialistMessage.findMany({ where: { role: 'user', created_at: { gte: since } }, select: { lead_id: true } });
    const chatIds = [...new Set(userMsgs.map((m) => m.lead_id))];
    const [sentToday, openedToday, meetingToday, callbackToday] = await Promise.all([
      prisma.compounderLead.count({ where: { ai_specialist_sms_sent_at: { gte: since } } }),
      prisma.compounderLead.count({ where: { ai_specialist_opened_at: { gte: since } } }),
      prisma.compounderEvent.count({ where: { event: 'meeting_notified', created_at: { gte: since } } }),
      prisma.compounderEvent.count({ where: { event: 'callback_notified', created_at: { gte: since } } }),
    ]);
    let chatters = [];
    if (chatIds.length) {
      const rows = await prisma.compounderLead.findMany({ where: { id: { in: chatIds }, is_test: false }, select: { id: true, name: true, email: true, phone: true, ai_specialist_summary: true } });
      chatters = rows.map((r) => ({ name: r.name || r.email || ('lead #' + r.id), phone: r.phone || '', summary: r.ai_specialist_summary || '' }));
    }
    return { chatCount: chatters.length, sentToday, openedToday, meetingToday, callbackToday, chatters };
  } catch (e) { return { chatCount: 0, sentToday: 0, openedToday: 0, meetingToday: 0, callbackToday: 0, chatters: [] }; }
}

async function computeDigest() {
  const since = startOfToday();
  const aispec = await computeAispecToday(since);
  const evs = await prisma.compounderEvent.findMany({
    where: { created_at: { gte: since } },
    select: { event: true, props: true, created_at: true },
    take: 50000,
  });
  // Agregace na leada
  const byLead = new Map();
  for (const e of evs) {
    const p = e.props || {};
    const lid = p.lead_id;
    if (lid == null) continue;
    let a = byLead.get(lid);
    if (!a) { a = { events: 0, ms: 0, pages: {}, sections: {}, docs: 0, contact: 0, purchase: 0, eco: 0, lastAt: null }; byLead.set(lid, a); }
    a.events += 1;
    // Čas poslední aktivity leada (pro „v kolik hodin byl aktivní").
    if (e.created_at && (!a.lastAt || e.created_at > a.lastAt)) a.lastAt = e.created_at;
    if ((e.event === 'visit_end' || e.event === 'page_leave') && p.ms) a.ms += Number(p.ms) || 0;
    if (e.event === 'page_switch' && p.page) a.pages[p.page] = (a.pages[p.page] || 0) + 1;
    if (e.event === 'section_view' && p.section) a.sections[p.section] = (a.sections[p.section] || 0) + 1;
    if (e.event === 'doc_download') a.docs += 1;
    if (e.event === 'contact_request') a.contact += 1;
    if (e.event === 'purchase_inquiry') a.purchase += 1;
    if (typeof e.event === 'string' && e.event.indexOf('eco_') === 0) a.eco += 1;
  }
  const ids = [...byLead.keys()];
  if (!ids.length) return { activeCount: 0, perLead: [], perSales: [], aispec };

  const leads = await prisma.compounderLead.findMany({
    where: { id: { in: ids }, is_test: false }, // testovací kontakty do denního hodnocení nepočítáme
    select: { id: true, name: true, email: true, owner_person_id: true },
  });
  const leadMap = new Map(leads.map((l) => [l.id, l]));
  const ownerIds = [...new Set(leads.map((l) => l.owner_person_id).filter(Boolean))];
  const owners = ownerIds.length
    ? await prisma.person.findMany({ where: { id: { in: ownerIds } }, select: { id: true, first_name: true, last_name: true } })
    : [];
  const ownerName = new Map(owners.map((o) => [o.id, `${o.first_name || ''} ${o.last_name || ''}`.trim()]));

  const perLead = [];
  const perSales = new Map();
  for (const [lid, a] of byLead) {
    const lead = leadMap.get(lid);
    if (!lead) continue;
    if (isTestLead(lead.email)) continue; // testovací leady vyjmout
    // Co zákazníka zajímalo nejvíc — akce mají přednost před stránkami/sekcemi.
    let interest;
    if (a.purchase) interest = 'poptávka nákupu';
    else if (a.contact) interest = 'žádost o kontakt';
    else if (a.eco) interest = 'detailní ekonomika';
    else if (a.docs) interest = 'stažení výkresů';
    else interest = pageName(topKey(a.pages) || topKey(a.sections));
    const owner = lead.owner_person_id || null;
    perLead.push({
      id: lid, name: lead.name || lead.email || ('lead #' + lid),
      minutes: fmtMin(a.ms), ms: a.ms, events: a.events, interest,
      lastAt: a.lastAt ? new Date(a.lastAt).toISOString() : null,
      ownerName: owner ? (ownerName.get(owner) || ('#' + owner)) : null,
    });
    if (owner) {
      let s = perSales.get(owner);
      if (!s) { s = { name: ownerName.get(owner) || ('#' + owner), leads: 0, events: 0, ms: 0 }; perSales.set(owner, s); }
      s.leads += 1; s.events += a.events; s.ms += a.ms;
    }
  }
  perLead.sort((x, y) => y.events - x.events);
  const perSales2 = [...perSales.values()].sort((x, y) => y.events - x.events);
  return { activeCount: perLead.length, perLead, perSales: perSales2, aispec };
}

// Přidá do textu digestu sekci AI specialisty (dnešní chaty + doporučení na ráno).
function appendAispec(lines, a) {
  if (!a) return;
  lines.push('');
  lines.push('— AI SPECIALISTA (dnes) —');
  lines.push(`Odesláno odkazů: ${a.sentToday} · otevřelo: ${a.openedToday} · chatovalo: ${a.chatCount} · zájem o schůzku: ${a.meetingToday} · žádost o zavolání: ${a.callbackToday}`);
  if (a.chatters && a.chatters.length) {
    lines.push('Dnes chatovali (na co reagovat ráno):');
    a.chatters.slice(0, 20).forEach((c) => {
      const s = String(c.summary || '').replace(/\*\*/g, '').replace(/\s*\n+\s*/g, ' ').trim().slice(0, 200);
      lines.push(`• ${c.name}${c.phone ? ' (' + c.phone + ')' : ''}: ${s || 'chatoval — vygeneruj shrnutí u leada'}`);
    });
  }
}

function buildText(d) {
  const dateStr = new Intl.DateTimeFormat('cs-CZ', { timeZone: process.env.VELIN_TZ || 'Europe/Prague', dateStyle: 'long' }).format(new Date());
  if (!d.activeCount) {
    const l0 = [`${dateStr}`, '', 'Dnes nebyl aktivní žádný (nezkušební) lead.'];
    appendAispec(l0, d.aispec);
    return { title: '📊 Denní hodnocení leadů', body: l0.join('\n') };
  }
  const lines = [];
  lines.push(`${dateStr}`);
  lines.push(`Aktivních leadů: ${d.activeCount}`);
  const topLead = d.perLead[0];
  if (topLead) lines.push(`🔥 Nejaktivnější lead: ${topLead.name} — ${topLead.events} akcí, ${topLead.minutes}, zajímalo: ${topLead.interest}`);
  const topSales = d.perSales[0];
  if (topSales) lines.push(`🏆 Nejaktivnější obchodník: ${topSales.name} — ${topSales.leads} akt. kontaktů, ${topSales.events} akcí`);
  lines.push('');
  lines.push('— LEADY —');
  d.perLead.slice(0, 40).forEach((l) => {
    lines.push(`• ${l.name} — ${l.minutes}, zajímalo: ${l.interest}${l.ownerName ? ` [obch.: ${l.ownerName}]` : ''}`);
  });
  if (d.perSales.length) {
    lines.push('');
    lines.push('— OBCHODNÍCI (dnešní hodnocení) —');
    d.perSales.forEach((s) => {
      lines.push(`• ${s.name}: ${s.leads} akt. kontaktů, ${s.events} akcí, ${fmtMin(s.ms)}`);
    });
  }
  appendAispec(lines, d.aispec);
  return { title: `📊 Denní hodnocení leadů — ${d.activeCount} aktivních`, body: lines.join('\n') };
}

// Vytvoří ve Velíně čitelnou položku (úkol s celým textem) — push nese jen náhled,
// tady si Jan/Tomáš přečtou celé hodnocení v záložce „Dnes".
async function createVelinItems(title, body) {
  let personIds = [];
  try { personIds = await notify.resolveRecipientPersonIds(prisma); } catch (e) { personIds = []; }
  if (!Array.isArray(personIds) || !personIds.length) return 0;
  const today = startOfToday();
  let created = 0;
  for (const pid of personIds) {
    try {
      const plan = await prisma.dailyPlan.upsert({
        where: { person_id_date: { person_id: pid, date: today } },
        create: { person_id: pid, date: today, generated_by: 'manager', status: 'published' },
        update: {},
      });
      await prisma.taskAssignment.create({
        data: { daily_plan_id: plan.id, person_id: pid, created_by: 'manager', source: 'manager', title: title, description: body, priority: 3, status: 'proposed' },
      });
      created += 1;
    } catch (e) { console.error('[compounder-digest] velin item person ' + pid + ':', e.message); }
  }
  return created;
}

async function runDigest() {
  try {
    const d = await computeDigest();
    const msg = buildText(d);
    await notify.notifyOwnersMessage(prisma, { title: msg.title, body: msg.body, data: { type: 'compounder_digest' } });
    await createVelinItems(msg.title, msg.body);
    _lastResult = { ok: true, at: new Date(), activeCount: d.activeCount };
    console.log(`[compounder-digest] Odesláno denní hodnocení: ${d.activeCount} aktivních leadů.`);
    return _lastResult;
  } catch (e) {
    _lastResult = { ok: false, at: new Date(), error: e.message };
    console.error('[compounder-digest] runDigest selhal:', e.message);
    return _lastResult;
  }
}

async function tick() {
  const now = new Date();
  if (now.getHours() === MARK_H && now.getMinutes() === MARK_M) {
    const key = tzToday();
    if (_lastFired === key) return;
    _lastFired = key;
    await runDigest();
  }
}

function start() {
  if (process.env.COMPOUNDER_DIGEST_DISABLED === '1') {
    console.log('[compounder-digest] DISABLED via COMPOUNDER_DIGEST_DISABLED=1');
    return;
  }
  if (_tick) return;
  console.log('[compounder-digest] start — tick 60 s, marker 23:55, denní hodnocení leadů do Velína.');
  _tick = setInterval(tick, TICK_INTERVAL_MS);
}
function stop() { if (_tick) { clearInterval(_tick); _tick = null; } }
async function runNow() { return runDigest(); }

module.exports = { start, stop, runNow, computeDigest };
