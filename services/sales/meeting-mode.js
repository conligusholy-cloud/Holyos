// =============================================================================
// HolyOS — Obchodník: režim „schůzky s majitelem" (Dnes + Statistiky + AI vedoucí)
// =============================================================================
// Úkol obchodníka: domlouvat online schůzky s majitelem (jednatelem). Pracovní fond 8 h/den (bez ručního zadávání).
// Vyhodnocuje se: kolik schůzek domluvil (dnes / týden / měsíc vs. cíl), úspěšnost (proběhla / nedorazil / zrušena)
// a následný obchod (kontakt přešel do stavu Prodáno).
// Zdroj schůzek: MeetingReservation.booked_by_person_id (tlačítko „Online schůzka s majitelem").
// AI vedoucí: krátká zpráva + 3 kroky (Claude, cache 20 min), s deterministickým záložním textem.

'use strict';

const { prisma } = require('../../config/database');
const stats = require('../meeting/owner-stats');

const FUND_MIN = 480; // 8 h
const DEFAULT_TARGET = 3; // výchozí cíl schůzek/den, dokud ho vedení nenastaví (HolyOS → Schůzky obchodníků)
const WARM_CALLS_PER_MEETING = 4; // teplé leady z našich kampaní: ~4 hovory na 1 domluvenou schůzku (dokud není vlastní historie)
const MIN_PER_CALL = 6; // hovor s naším kontaktem vč. zápisu výsledku
const MIN_PER_PROSPECT = 12; // vlastní nový kontakt: dohledat (firma, telefon, majitel) + zavolat + zapsat
const CLOSED = ['nezajem', 'nelze_pouzit', 'rejected', 'prodano', 'converted', 'schuzka', 'schuzka_online'];
const DEAL_STATUSES = ['prodano', 'converted'];
const AI_CACHE = new Map(); // personId → { at, key, data }

function mondayKey(now) {
  const d = new Date(now); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd);
  return stats.dayKey(d);
}
function workingDaysInMonth(now) {
  const y = now.getFullYear(), m = now.getMonth(); const last = new Date(y, m + 1, 0).getDate(); let n = 0;
  for (let d = 1; d <= last; d++) { const w = new Date(y, m, d).getDay(); if (w >= 1 && w <= 5) n++; }
  return n;
}
function workingDaysLeftInMonth(now) {
  const y = now.getFullYear(), m = now.getMonth(); const last = new Date(y, m + 1, 0).getDate(); let n = 0;
  for (let d = now.getDate(); d <= last; d++) { const w = new Date(y, m, d).getDay(); if (w >= 1 && w <= 5) n++; }
  return n;
}

async function getState(personId) {
  const now = new Date();
  const today = stats.dayKey(now);
  const wkStart = mondayKey(now);
  const monthKey = today.slice(0, 7);
  const since90 = new Date(Date.now() - 90 * 86400000);
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);

  const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true, first_name: true, last_name: true } });
  const rows = await prisma.meetingReservation.findMany({
    where: { booked_by_person_id: personId, created_at: { gte: since90 } },
    orderBy: { created_at: 'desc' },
    select: { id: true, name: true, status: true, created_at: true, compounder_lead_id: true, slot: { select: { starts_at: true } } },
  });

  const t = Number(await stats.getTarget()) || 0; const targetSet = t > 0; const target = targetSet ? t : DEFAULT_TARGET;
  const nowMs = now.getTime();
  const c = { today: 0, week: 0, month: 0 }; const byDay = {};
  const out = { done: 0, no_show: 0, canceled: 0, upcoming: 0, unmarked: 0 };
  const upcoming = [];
  rows.forEach((r) => {
    const k = stats.dayKey(r.created_at);
    if (r.status !== 'canceled') {
      byDay[k] = (byDay[k] || 0) + 1;
      if (k === today) c.today++;
      if (k >= wkStart) c.week++;
      if (k.slice(0, 7) === monthKey) c.month++;
    }
    const start = r.slot && r.slot.starts_at ? new Date(r.slot.starts_at).getTime() : 0;
    if (r.status === 'canceled') out.canceled++;
    else if (r.status === 'done') out.done++;
    else if (r.status === 'no_show') out.no_show++;
    else if (start > nowMs) { out.upcoming++; upcoming.push({ id: r.id, name: r.name, starts_at: r.slot.starts_at, lead_id: r.compounder_lead_id }); }
    else out.unmarked++;
  });
  upcoming.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const resolved = out.done + out.no_show + out.canceled + out.unmarked;
  const rate = resolved ? Math.round((out.done / resolved) * 1000) / 10 : null;

  // Následný obchod: kontakty z mých nezrušených schůzek, které jsou ve stavu Prodáno
  const leadIds = Array.from(new Set(rows.filter((r) => r.status !== 'canceled' && r.compounder_lead_id).map((r) => r.compounder_lead_id)));
  let deals = [];
  if (leadIds.length) {
    const ls = await prisma.compounderLead.findMany({ where: { id: { in: leadIds }, status: { in: DEAL_STATUSES } }, select: { id: true, name: true } });
    deals = ls.map((l) => ({ lead_id: l.id, name: l.name }));
  }
  const heldTotal = out.done;
  const dealRate = heldTotal ? Math.round((deals.length / heldTotal) * 1000) / 10 : null;

  // 14 dní historie (domluveno za den)
  const history = stats.lastDays(14).map((k) => ({ d: k, n: byDay[k] || 0 }));

  // Práce dnes: hovory (akce „call") + odhad odpracovaného času od první akce dne
  let callsToday = 0, firstActionAt = null, calls30 = 0;
  try {
    const evs = await prisma.compounderEvent.findMany({
      where: { event: 'sales_action', created_at: { gte: dayStart }, props: { path: ['person_id'], equals: personId } },
      select: { props: true, created_at: true }, orderBy: { created_at: 'asc' }, take: 5000,
    });
    callsToday = evs.filter((e) => e.props && e.props.action === 'call').length;
    if (evs.length) firstActionAt = evs[0].created_at;
    calls30 = await prisma.compounderEvent.count({ where: { event: 'sales_action', created_at: { gte: new Date(Date.now() - 30 * 86400000) }, props: { path: ['person_id'], equals: personId } } }).catch(() => 0);
  } catch (e) { /* best-effort */ }
  const workedMin = firstActionAt ? Math.min(FUND_MIN, Math.round((nowMs - new Date(firstActionAt).getTime()) / 60000)) : 0;
  const remainingMin = Math.max(0, FUND_MIN - workedMin);

  // Plán: kolik hovorů je potřeba na zbývající schůzky. Naše kontakty jsou teplé leady z kampaní → výchozí 4 hovory na schůzku;
  // jakmile má obchodník historii (≥3 schůzky za 30 dní), bere se jeho skutečný poměr (2–15).
  const meetings30 = rows.filter((r) => r.status !== 'canceled' && new Date(r.created_at).getTime() > Date.now() - 30 * 86400000).length;
  const callsPerMeeting = (meetings30 >= 3 && calls30 > 0) ? Math.min(15, Math.max(2, Math.round(calls30 / meetings30))) : WARM_CALLS_PER_MEETING;
  const remaining = Math.max(0, target - c.today);
  const callsNeeded = remaining * callsPerMeeting;

  // Fronta kontaktů k obvolání: nikdy nevolané (nejnovější první) → „volat příště"
  const queueWhere = { owner_person_id: personId, is_test: false, status: { notIn: CLOSED }, OR: [{ last_called_at: null }, { status: 'volat_pristi' }] };
  const available = await prisma.compounderLead.count({ where: queueWhere }).catch(() => 0);

  // 100% vytížení: nejdřív obvolat všechny dostupné kontakty (aspoň tolik, kolik je potřeba na cíl),
  // zbytek fondu = vyhledat a obvolat vlastní nové kontakty. Když kontakty na cíl nestačí, chybějící si musí sehnat.
  const callsFromQueue = available;
  const queueMin = Math.min(remainingMin, callsFromQueue * MIN_PER_CALL);
  const shortForTarget = Math.max(0, callsNeeded - available); // kolik kontaktů chybí jen kvůli dnešnímu cíli
  const freeMin = Math.max(0, remainingMin - queueMin);
  const contactsToSource = Math.max(shortForTarget, Math.floor(freeMin / MIN_PER_PROSPECT)); // nové kontakty, které musí sám najít a oslovit
  const plannedCalls = Math.min(callsFromQueue, Math.floor(remainingMin / MIN_PER_CALL)) + contactsToSource;
  const callsPerHour = remainingMin > 0 ? Math.ceil(plannedCalls / Math.max(1, remainingMin / 60)) : plannedCalls;

  const queue = await prisma.compounderLead.findMany({
    where: queueWhere,
    orderBy: [{ last_called_at: { sort: 'asc', nulls: 'first' } }, { created_at: 'desc' }],
    take: 10,
    select: { id: true, name: true, phone: true, status: true, created_at: true, last_called_at: true, lang: true, only_polish: true },
  }).catch(() => []);
  const uncalled = await prisma.compounderLead.count({ where: { owner_person_id: personId, is_test: false, last_called_at: null, status: { notIn: CLOSED } } }).catch(() => 0);

  const monthTarget = targetSet ? t * workingDaysInMonth(now) : 0;
  return {
    person: { id: personId, name: person ? ((person.first_name || '') + ' ' + (person.last_name || '')).trim() : '' },
    date: today, fund_min: FUND_MIN, worked_min: workedMin, remaining_min: remainingMin, first_action_at: firstActionAt,
    target, target_set: targetSet, month_target: monthTarget, working_days_left: workingDaysLeftInMonth(now),
    booked: c, remaining_today: remaining,
    outcomes: out, success_rate: rate, resolved,
    deals: { count: deals.length, rate: dealRate, list: deals.slice(0, 10) },
    history, upcoming: upcoming.slice(0, 6),
    calls_today: callsToday, calls_per_meeting: callsPerMeeting, calls_needed: callsNeeded, calls_per_hour: callsPerHour,
    available_contacts: available, queue_min: queueMin, contacts_to_source: contactsToSource, short_for_target: shortForTarget,
    prospect_min: Math.max(0, remainingMin - queueMin), planned_calls: plannedCalls, min_per_call: MIN_PER_CALL, min_per_prospect: MIN_PER_PROSPECT,
    uncalled, queue,
  };
}

function fallbackCoach(s) {
  const first = (s.person.name || '').split(' ')[0] || '';
  const left = s.remaining_today;
  const h = Math.floor(s.remaining_min / 60), m = s.remaining_min % 60;
  let message;
  if (left <= 0) message = (first ? first + ', ' : '') + 'dnešní cíl ' + s.target + ' schůzek máš splněný (' + s.booked.today + '). Skvělé — držíme tempo a jdeme na další, každá schůzka navíc se počítá.';
  else message = (first ? first + ', ' : '') + 'dnes máš domluvit ' + s.target + ' schůzek s majitelem, zatím ' + s.booked.today + '. Na zbývající ' + left + ' potřebuješ asi ' + s.calls_needed + ' hovorů. Ve frontě máš ' + s.available_contacts + ' kontaktů (~' + s.queue_min + ' min)'
    + (s.contacts_to_source > 0 ? ', zbytek dne (' + (h ? h + ' h ' : '') + m + ' min celkem) vyplň vlastními kontakty — sežeň a oslov aspoň ' + s.contacts_to_source + ' nových.' : '.') + ' Začni hned prvním kontaktem ve frontě.';
  const steps = s.available_contacts > 0 ? ['Obvolej všech ' + s.available_contacts + ' kontaktů ve frontě', 'Při zájmu hned nabídni online schůzku s majitelem'] : ['Fronta je prázdná — hned si sežeň nové kontakty'];
  if (s.contacts_to_source > 0) steps.push('Přidej a oslov ' + s.contacts_to_source + ' vlastních nových kontaktů (+ Nový kontakt)');
  else steps.push('Po hovoru zapiš výsledek a jdi na dalšího');
  return { message, steps };
}

async function coach(personId, s) {
  const key = [s.booked.today, s.remaining_min >> 5, s.booked.week, s.available_contacts].join('|');
  const c = AI_CACHE.get(personId);
  if (c && c.key === key && Date.now() - c.at < 20 * 60 * 1000) return c.data;
  let data = fallbackCoach(s);
  try {
    const sm = require('../ai/sales-manager');
    const sys = 'Jsi AI vedoucí obchodu firmy Best Series (prádlomaty). Obchodník má JEDINÝ úkol: domlouvat ONLINE SCHŮZKY S MAJITELEM (jednatelem) pro zájemce o prádlomat — neprodává, nenabízí cenu, jen schůzku. Pracovní den má 8 hodin a musí být 100% vytížený. Kontakty ve frontě jsou TEPLÉ leady z našich kampaní (sami projevili zájem) — volá je jako první. Když fronta na cíl nebo na celý den nestačí, musí si SÁM SEHNAT nové kontakty (provozovny, firmy, majitelé nemovitostí) a přidat je přes „+ Nový kontakt" — počet je v datech (vlastnich_kontaktu_sehnat). Netlač nesmyslné počty hovorů nad rámec dat. '
      + 'Honíš ho k výkonu: jsi přímý, konkrétní, náročný ale férový a motivující, tykáš mu, česky. Nehaluzuj čísla — používej jen data z JSON. '
      + 'Vrať POUZE JSON: {"message":"2–4 věty: kde je vůči cíli, kolik zbývá schůzek a hovorů, tempo za hodinu, jedna konkrétní výzva","steps":["krok 1","krok 2","krok 3"]} (kroky krátké, rozkazovací způsob, max 12 slov).';
    const usr = 'DATA OBCHODNÍKA (JSON):\n' + JSON.stringify({
      jmeno: s.person.name, cil_schuzek_za_den: s.target, domluveno_dnes: s.booked.today, domluveno_tyden: s.booked.week, domluveno_mesic: s.booked.month,
      zbyva_schuzek_dnes: s.remaining_today, zbyva_minut_prace: s.remaining_min, hovoru_dnes: s.calls_today, hovoru_na_schuzku_historicky: s.calls_per_meeting,
      potrebnych_hovoru_na_cil: s.calls_needed, kontaktu_ve_fronte: s.available_contacts, minut_na_frontu: s.queue_min,
      vlastnich_kontaktu_sehnat: s.contacts_to_source, z_toho_chybi_na_cil: s.short_for_target, minut_na_vlastni_kontakty: s.prospect_min,
      planovanych_hovoru_celkem: s.planned_calls, hovoru_za_hodinu: s.calls_per_hour, nevolanych_kontaktu: s.uncalled, uspesnost_schuzek_procent: s.success_rate,
      probehlo: s.outcomes.done, nedorazilo: s.outcomes.no_show, zruseno: s.outcomes.canceled, obchodu_z_schuzek: s.deals.count,
    });
    const r = await sm.callClaudeJSON(sys, usr, 600);
    if (r && typeof r.message === 'string' && r.message.trim()) data = { message: r.message.trim().slice(0, 700), steps: Array.isArray(r.steps) ? r.steps.map((x) => String(x).slice(0, 120)).slice(0, 4) : data.steps };
  } catch (e) { console.warn('[meeting-mode] AI vedoucí:', e.message); }
  AI_CACHE.set(personId, { at: Date.now(), key, data });
  return data;
}

async function getDay(personId) {
  const s = await getState(personId);
  s.coach = await coach(personId, s);
  return s;
}

module.exports = { getState, getDay, FUND_MIN, DEFAULT_TARGET };
