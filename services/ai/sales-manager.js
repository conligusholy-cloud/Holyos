// =============================================================================
// HolyOS — Autonomní AI vedoucí obchodu
// =============================================================================
// Mozek AI vedoucího: každý den obchodníkovi rozdá úkoly (planDay), večer den
// vyhodnotí (reviewDay) a týdně/měsíčně sestaví hodnocení k výplatě
// (reviewPeriod). Navíc denně reportuje majitelům (Jan + Tomáš), jaké úkoly a
// cíle zadal, co se splnilo a jak hodnotí spolupráci obchodníků (reportToOwners).
//
// Volá se z workeru services/sales/sales-manager-worker.js a z API
// (routes/compounder.routes.js). Bez ANTHROPIC_API_KEY spadne na deterministický
// fallback, aby modul fungoval i bez AI.

'use strict';

const { prisma } = require('../../config/database');

const TZ = process.env.VELIN_TZ || 'Europe/Prague';
const MODEL = process.env.SALES_MANAGER_MODEL || process.env.COMPOUNDER_LOCATION_MODEL || 'claude-sonnet-4-6';
const PAY_CURRENCY = process.env.SALES_PAY_CURRENCY || 'CZK';

// ─── Datum / periody (Europe/Prague) ─────────────────────────────────────────
function tzTodayStr(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
}
// Půlnoc daného dne jako UTC Date (ukládáme do @db.Date).
function dayDate(str) { return new Date((str || tzTodayStr()) + 'T00:00:00Z'); }
function fmtCz(d) {
  try { return new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, dateStyle: 'long' }).format(d); } catch (e) { return String(d); }
}
// Začátek/konec periody (day/week/month) pro daný referenční den (YYYY-MM-DD).
function periodBounds(kind, refStr) {
  const ref = new Date((refStr || tzTodayStr()) + 'T00:00:00Z');
  const y = ref.getUTCFullYear(); const m = ref.getUTCMonth(); const dd = ref.getUTCDate();
  if (kind === 'week') {
    const wd = (ref.getUTCDay() + 6) % 7; // pondělí=0
    const start = new Date(Date.UTC(y, m, dd - wd));
    const end = new Date(Date.UTC(y, m, dd - wd + 6));
    return { start, end };
  }
  if (kind === 'month') {
    const start = new Date(Date.UTC(y, m, 1));
    const end = new Date(Date.UTC(y, m + 1, 0));
    return { start, end };
  }
  return { start: new Date(Date.UTC(y, m, dd)), end: new Date(Date.UTC(y, m, dd)) };
}

// ─── Claude ──────────────────────────────────────────────────────────────────
async function callClaudeJSON(sys, usr, maxTokens) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: MODEL, max_tokens: maxTokens || 1200, system: sys,
      messages: [{ role: 'user', content: usr }],
    });
    let text = (msg && msg.content && msg.content[0] && msg.content[0].text) || '';
    text = text.replace(/^```(json)?/i, '').replace(/```\s*$/, '').trim();
    return JSON.parse(text);
  } catch (e) {
    console.error('[sales-manager] Claude JSON selhal:', e.message);
    return null;
  }
}

// ─── Osoby ─────────────────────────────────────────────────────────────────
async function getActiveSalespeople() {
  const people = await prisma.person.findMany({
    where: { active: true, OR: [{ is_salesperson: true }, { is_sales_lead: true }] },
    select: { id: true, first_name: true, last_name: true, is_salesperson: true, is_sales_lead: true },
    orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
  });
  return people.map((p) => ({
    id: p.id, name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || ('#' + p.id),
    is_salesperson: !!p.is_salesperson, is_sales_lead: !!p.is_sales_lead,
  }));
}

// Poslední řádky append-only logu aktivit.
function lastActivityLines(log, n) {
  if (!log) return [];
  return String(log).split('\n').map((s) => s.trim()).filter(Boolean).slice(-(n || 6));
}

// Cíle (SalesTarget) + skutečnost za periody pro danou osobu.
const PLAN_METRICS = ['new_contacts', 'conversions', 'reservations', 'revenue'];
const PLAN_PERIODS = ['day', 'week', 'month', 'year'];
function planPeriodStartMs(period) {
  const bounds = periodBounds(period === 'day' ? 'day' : period, tzTodayStr());
  return bounds.start.getTime();
}
async function computeActuals(personId) {
  const leads = await prisma.compounderLead.findMany({
    where: { owner_person_id: personId },
    select: { id: true, status: true, created_at: true, updated_at: true }, take: 10000,
  });
  const leadIds = leads.map((l) => l.id);
  let resv = [];
  if (leadIds.length) {
    try { resv = await prisma.locationReservation.findMany({ where: { lead_id: { in: leadIds } }, select: { created_at: true, purchase_price: true } }); } catch (e) { resv = []; }
  }
  const out = { new_contacts: {}, conversions: {}, reservations: {}, revenue: {} };
  PLAN_PERIODS.forEach((p) => {
    const from = planPeriodStartMs(p);
    out.new_contacts[p] = leads.filter((l) => l.created_at && new Date(l.created_at).getTime() >= from).length;
    out.conversions[p] = leads.filter((l) => l.status === 'converted' && l.updated_at && new Date(l.updated_at).getTime() >= from).length;
    const rIn = resv.filter((r) => r.created_at && new Date(r.created_at).getTime() >= from);
    out.reservations[p] = rIn.length;
    out.revenue[p] = rIn.reduce((s, r) => s + (r.purchase_price || 0), 0);
  });
  return out;
}
async function getTargets(personId) {
  const rows = await prisma.salesTarget.findMany({ where: { person_id: personId } });
  const t = {};
  rows.forEach((r) => { (t[r.metric] || (t[r.metric] = {}))[r.period] = r.value; });
  return t;
}

// ─── Kontext pro plánování dne ────────────────────────────────────────────────
async function gatherPlanContext(personId) {
  const leads = await prisma.compounderLead.findMany({
    where: { owner_person_id: personId },
    select: {
      id: true, name: true, email: true, phone: true, role: true, lang: true, status: true,
      notes: true, activity_log: true, created_at: true, updated_at: true,
      access_sent_count: true, access_last_sent_at: true,
    },
    orderBy: { updated_at: 'desc' }, take: 300,
  });
  const leadIds = leads.map((l) => l.id);
  let resv = [];
  if (leadIds.length) {
    try {
      resv = await prisma.locationReservation.findMany({
        where: { lead_id: { in: leadIds } },
        select: { lead_id: true, kiosk_code: true, status: true, reserved_until: true, sign_until: true, fee_until: true, purchase_price: true, currency: true },
        orderBy: { created_at: 'desc' }, take: 200,
      });
    } catch (e) { resv = []; }
  }
  const resvByLead = {};
  resv.forEach((r) => { (resvByLead[r.lead_id] || (resvByLead[r.lead_id] = [])).push(r); });

  const nowMs = Date.now();
  const leadFacts = leads.slice(0, 120).map((l) => {
    const lastAct = l.activity_log ? lastActivityLines(l.activity_log, 4) : [];
    const daysSinceUpdate = l.updated_at ? Math.floor((nowMs - new Date(l.updated_at).getTime()) / 86400000) : null;
    return {
      id: l.id, name: l.name, status: l.status, role: l.role, lang: l.lang,
      has_phone: !!l.phone, has_email: !!l.email,
      days_since_update: daysSinceUpdate,
      invite_sent: l.access_sent_count || 0,
      recent_activity: lastAct,
      notes: (l.notes || '').slice(0, 300),
      reservations: (resvByLead[l.id] || []).map((r) => ({ kiosk: r.kiosk_code, status: r.status, reserved_until: r.reserved_until, sign_until: r.sign_until, fee_until: r.fee_until })),
    };
  });

  // Předchozí den — nesplněné úkoly (přenést).
  const yStr = tzTodayStr(new Date(Date.now() - 86400000));
  const yPlan = await prisma.salesDayPlan.findUnique({ where: { person_id_date: { person_id: personId, date: dayDate(yStr) } }, include: { tasks: true } }).catch(() => null);
  const carryOver = yPlan ? yPlan.tasks.filter((t) => t.status === 'open').map((t) => ({ title: t.title, lead_id: t.lead_id, kind: t.kind })) : [];

  const targets = await getTargets(personId);
  const actuals = await computeActuals(personId);

  return {
    date: tzTodayStr(), leadCount: leads.length,
    leads: leadFacts, carry_over: carryOver, targets, actuals,
  };
}

// ─── planDay ───────────────────────────────────────────────────────────────
const TASK_KINDS = ['call', 'followup', 'invite', 'close', 'reservation', 'meeting', 'admin', 'other'];
function sanitizeKind(k) { return TASK_KINDS.indexOf(String(k || '').toLowerCase()) >= 0 ? String(k).toLowerCase() : 'other'; }
function clampPriority(p) { const n = Math.round(Number(p) || 3); return Math.max(1, Math.min(5, n)); }

async function planDayAI(person, ctx) {
  const sys = 'Jsi zkušený, náročný ale férový AI vedoucí obchodu firmy Best Series (prodej prémiových samoobslužných prádelen "Compounder" jako investičního aktiva). Tvým úkolem je obchodníkovi na dnešní den sestavit konkrétní, prioritizovaný a splnitelný seznam úkolů, které maximálně posunou obchod. Vycházej z jeho kontaktů (leadů), jejich stavu, poslední aktivity, neotevřených pozvánek, blížících se lhůt rezervací a z plnění cílů (plán vs. skutečnost). Zásady: 1) Priorita horkým leadům a hrozícím lhůtám (podpis/poplatek/expirace rezervace). 2) Oživit spící kontakty (dlouho beze změny). 3) Doslat neotevřené pozvánky. 4) Realisticky 4–8 úkolů na den, žádná vata. 5) Každý úkol má jasnou akci a když se týká konkrétního leadu, uveď jeho lead_id. Odpověz POUZE platným JSON bez markdownu ve tvaru: {"focus":"<1-2 věty zaměření dne česky>","tasks":[{"kind":"<call|followup|invite|close|reservation|meeting|admin|other>","title":"<krátce, konkrétně>","detail":"<co udělat, 1-2 věty>","reasoning":"<proč, krátce>","priority":<1-5>,"lead_id":<číslo nebo null>}]}. Piš česky.';
  const usr = 'Obchodník: ' + person.name + '\nKontext (JSON):\n' + JSON.stringify(ctx);
  const j = await callClaudeJSON(sys, usr, 1600);
  if (!j || !Array.isArray(j.tasks)) return null;
  return {
    focus: String(j.focus || '').slice(0, 400),
    tasks: j.tasks.slice(0, 12).map((t) => ({
      kind: sanitizeKind(t.kind), title: String(t.title || '').slice(0, 480),
      detail: t.detail ? String(t.detail).slice(0, 1000) : null,
      reasoning: t.reasoning ? String(t.reasoning).slice(0, 800) : null,
      priority: clampPriority(t.priority),
      lead_id: Number.isInteger(t.lead_id) ? t.lead_id : (Number(t.lead_id) > 0 ? Number(t.lead_id) : null),
    })).filter((t) => t.title),
  };
}
function planDayFallback(ctx) {
  const tasks = [];
  (ctx.leads || []).forEach((l) => {
    if (tasks.length >= 8) return;
    const r = (l.reservations || [])[0];
    if (r && (r.status === 'reserved' || r.status === 'active')) {
      tasks.push({ kind: 'close', title: 'Dotáhnout rezervaci ' + r.kiosk + ' – ' + l.name, detail: 'Hlídat podpis a poplatek, popohnat zákazníka.', reasoning: 'Běžící rezervace se lhůtou.', priority: 1, lead_id: l.id });
    } else if (l.invite_sent === 0 && l.has_email) {
      tasks.push({ kind: 'invite', title: 'Poslat přístup do portálu – ' + l.name, detail: 'Odeslat přihlašovací odkaz a ozvat se.', reasoning: 'Ještě nedostal pozvánku.', priority: 2, lead_id: l.id });
    } else if ((l.days_since_update || 0) >= 7) {
      tasks.push({ kind: 'followup', title: 'Oživit kontakt – ' + l.name, detail: 'Zavolat/napsat, zjistit stav.', reasoning: 'Přes týden beze změny.', priority: 3, lead_id: l.id });
    }
  });
  if (!tasks.length) tasks.push({ kind: 'other', title: 'Projít své kontakty a naplánovat oslovení', detail: 'Zkontrolovat pipeline a vytipovat priority.', reasoning: 'Žádná akutní akce z dat.', priority: 3, lead_id: null });
  return { focus: 'Zaměř se na běžící rezervace, neotevřené pozvánky a oživení spících kontaktů.', tasks: tasks.slice(0, 8) };
}

// Vytvoří/aktualizuje denní plán a úkoly. force=true přegeneruje (smaže staré open AI úkoly).
async function planDay(personId, dateStr, opts) {
  const date = dayDate(dateStr);
  const person = { id: personId, name: (await prisma.person.findUnique({ where: { id: personId }, select: { first_name: true, last_name: true } }).then((p) => p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : ('#' + personId)).catch(() => '#' + personId)) };
  const existing = await prisma.salesDayPlan.findUnique({ where: { person_id_date: { person_id: personId, date } }, include: { tasks: true } });
  if (existing && existing.tasks.length && !(opts && opts.force)) return { plan: existing, created: 0, skipped: true };

  const ctx = await gatherPlanContext(personId);
  let out = await planDayAI(person, ctx);
  if (!out) out = planDayFallback(ctx);

  const plan = await prisma.salesDayPlan.upsert({
    where: { person_id_date: { person_id: personId, date } },
    create: { person_id: personId, date, generated_by: 'ai', focus: out.focus, status: 'published' },
    update: { focus: out.focus, generated_by: 'ai', generated_at: new Date() },
  });
  if (opts && opts.force) {
    await prisma.salesTask.deleteMany({ where: { day_plan_id: plan.id, status: 'open', created_at: { lt: new Date(Date.now() - 1000) } } }).catch(() => {});
  }
  let created = 0;
  for (const t of out.tasks) {
    await prisma.salesTask.create({ data: { day_plan_id: plan.id, person_id: personId, lead_id: t.lead_id, kind: t.kind, title: t.title, detail: t.detail, reasoning: t.reasoning, priority: t.priority, status: 'open' } });
    created += 1;
  }
  const full = await prisma.salesDayPlan.findUnique({ where: { id: plan.id }, include: { tasks: true } });
  return { plan: full, created, skipped: false };
}

// ─── reviewDay ───────────────────────────────────────────────────────────────
async function gatherDayResult(personId, dateStr) {
  const date = dayDate(dateStr);
  const plan = await prisma.salesDayPlan.findUnique({ where: { person_id_date: { person_id: personId, date } }, include: { tasks: true } });
  const tasks = plan ? plan.tasks : [];
  const done = tasks.filter((t) => t.status === 'done');
  const skipped = tasks.filter((t) => t.status === 'skipped');
  const open = tasks.filter((t) => t.status === 'open');

  // Dnešní skutečná aktivita napříč leady (z activity_log + stavy).
  const startMs = date.getTime();
  const endMs = startMs + 86400000;
  const leads = await prisma.compounderLead.findMany({
    where: { owner_person_id: personId },
    select: { id: true, name: true, status: true, activity_log: true, created_at: true, updated_at: true }, take: 5000,
  });
  let newToday = 0; let convToday = 0; const activityLines = [];
  leads.forEach((l) => {
    if (l.created_at && new Date(l.created_at).getTime() >= startMs && new Date(l.created_at).getTime() < endMs) newToday += 1;
    if (l.status === 'converted' && l.updated_at && new Date(l.updated_at).getTime() >= startMs && new Date(l.updated_at).getTime() < endMs) convToday += 1;
    lastActivityLines(l.activity_log, 30).forEach((line) => {
      // Řádky mají obvykle prefix s datem; hrubě filtrovat na dnešek podle YYYY-MM-DD nebo DD.MM.
      if (line.indexOf(dateStr) >= 0) activityLines.push(l.name + ': ' + line);
    });
  });
  return {
    date: dateStr,
    tasks_total: tasks.length, tasks_done: done.length, tasks_skipped: skipped.length, tasks_open: open.length,
    done_titles: done.map((t) => t.title), skipped_titles: skipped.map((t) => ({ title: t.title, reason: t.skipped_reason })), open_titles: open.map((t) => t.title),
    done_notes: done.map((t) => t.done_note).filter(Boolean).slice(0, 20),
    new_contacts_today: newToday, conversions_today: convToday,
    activity_today: activityLines.slice(0, 40),
  };
}
async function reviewDayAI(person, result) {
  const sys = 'Jsi AI vedoucí obchodu Best Series. Zhodnoť DNEŠNÍ výkon obchodníka na základě zadaných úkolů a toho, co reálně splnil (splněné/přeskočené/nesplněné úkoly, poznámky, nové kontakty, konverze, aktivita). Buď konkrétní a férový, oceň i pochval, ale pojmenuj i to, co nedotáhl. Odpověz POUZE platným JSON bez markdownu: {"score":<0-100>,"grade":"<1 slovo: Výborný|Dobrý|Průměrný|Slabý>","summary":"<2-4 věty česky>","highlights":"<co se povedlo, 1-2 věty nebo prázdné>","improvements":"<co zítra zlepšit, 1-2 věty>"}. Piš česky.';
  const usr = 'Obchodník: ' + person.name + '\nVýsledek dne (JSON):\n' + JSON.stringify(result);
  const j = await callClaudeJSON(sys, usr, 700);
  if (!j) return null;
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(j.score) || 0))),
    grade: String(j.grade || '').slice(0, 30),
    summary: String(j.summary || '').slice(0, 1200),
    highlights: j.highlights ? String(j.highlights).slice(0, 800) : null,
    improvements: j.improvements ? String(j.improvements).slice(0, 800) : null,
  };
}
function reviewDayFallback(r) {
  const ratio = r.tasks_total ? r.tasks_done / r.tasks_total : 0;
  let score = Math.round(ratio * 70) + Math.min(30, (r.new_contacts_today * 8) + (r.conversions_today * 15));
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 80 ? 'Výborný' : score >= 55 ? 'Dobrý' : score >= 30 ? 'Průměrný' : 'Slabý';
  return {
    score, grade,
    summary: `Splněno ${r.tasks_done}/${r.tasks_total} úkolů, ${r.new_contacts_today} nových kontaktů, ${r.conversions_today} konverzí.`,
    highlights: r.tasks_done ? ('Dokončil: ' + r.done_titles.slice(0, 3).join(', ')) : null,
    improvements: r.tasks_open ? ('Nedotaženo: ' + r.open_titles.slice(0, 3).join(', ')) : null,
  };
}
async function reviewDay(personId, dateStr) {
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { first_name: true, last_name: true } }).catch(() => null);
  const pName = person ? `${person.first_name || ''} ${person.last_name || ''}`.trim() : ('#' + personId);
  const result = await gatherDayResult(personId, dateStr);
  let out = await reviewDayAI({ name: pName }, result);
  if (!out) out = reviewDayFallback(result);
  const start = dayDate(dateStr);
  const review = await prisma.salesReview.upsert({
    where: { person_id_kind_period_start: { person_id: personId, kind: 'day', period_start: start } },
    create: { person_id: personId, kind: 'day', period_start: start, period_end: start, score: out.score, grade: out.grade, summary: out.summary, highlights: out.highlights, improvements: out.improvements, metrics: result },
    update: { score: out.score, grade: out.grade, summary: out.summary, highlights: out.highlights, improvements: out.improvements, metrics: result, generated_at: new Date() },
  });
  return review;
}

// ─── reviewPeriod (week/month) ────────────────────────────────────────────────
async function gatherPeriodResult(personId, kind, refStr) {
  const { start, end } = periodBounds(kind, refStr);
  const dayReviews = await prisma.salesReview.findMany({
    where: { person_id: personId, kind: 'day', period_start: { gte: start, lte: end } },
    orderBy: { period_start: 'asc' },
    select: { period_start: true, score: true, grade: true, summary: true, metrics: true },
  });
  const scores = dayReviews.map((d) => d.score).filter((n) => Number.isFinite(n));
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const tasksDone = dayReviews.reduce((s, d) => s + ((d.metrics && d.metrics.tasks_done) || 0), 0);
  const tasksTotal = dayReviews.reduce((s, d) => s + ((d.metrics && d.metrics.tasks_total) || 0), 0);

  const targets = await getTargets(personId);
  const actuals = await computeActuals(personId);
  const pk = kind === 'month' ? 'month' : 'week';
  const planVsActual = PLAN_METRICS.map((m) => ({ metric: m, target: (targets[m] && targets[m][pk]) || 0, actual: (actuals[m] && actuals[m][pk]) || 0 }));

  return {
    kind, from: tzTodayStr(start), to: tzTodayStr(end),
    days_reviewed: dayReviews.length, avg_day_score: avgScore,
    tasks_done: tasksDone, tasks_total: tasksTotal,
    plan_vs_actual: planVsActual,
    revenue_period: (actuals.revenue && actuals.revenue[pk]) || 0,
    reservations_period: (actuals.reservations && actuals.reservations[pk]) || 0,
    conversions_period: (actuals.conversions && actuals.conversions[pk]) || 0,
    day_summaries: dayReviews.map((d) => ({ date: tzTodayStr(d.period_start), score: d.score, summary: (d.summary || '').slice(0, 200) })),
  };
}
async function reviewPeriodAI(person, kind, result) {
  const label = kind === 'month' ? 'MĚSÍČNÍ' : 'TÝDENNÍ';
  const payAsk = kind === 'month'
    ? ' Navíc navrhni podklad k VÝPLATĚ v ' + PAY_CURRENCY + ' (jen návrh, vedoucí schvaluje): pay_base (základ), pay_bonus (bonus za plnění cílů a kvalitu), pay_commission (provize z obratu, orientačně) a pay_total. Vysvětli návrh v pay_note. Bez znalosti mzdových tabulek buď střízlivý a označ částky jako orientační.'
    : ' Pole pay_* nech null.';
  const sys = 'Jsi AI vedoucí obchodu Best Series. Sestav ' + label + ' hodnocení obchodníka: agreguj denní hodnocení, plnění cílů (plán vs. skutečnost), obrat, rezervace, konverze a plnění úkolů. Buď konkrétní, férový a motivující, ale pojmenuj slabiny.' + payAsk + ' Odpověz POUZE platným JSON bez markdownu: {"score":<0-100>,"grade":"<1 slovo>","summary":"<3-5 vět česky>","highlights":"<co se povedlo>","improvements":"<co zlepšit>","pay_base":<číslo|null>,"pay_bonus":<číslo|null>,"pay_commission":<číslo|null>,"pay_total":<číslo|null>,"pay_note":"<zdůvodnění nebo prázdné>"}. Piš česky.';
  const usr = 'Obchodník: ' + person.name + '\nPerioda (JSON):\n' + JSON.stringify(result);
  const j = await callClaudeJSON(sys, usr, 1100);
  if (!j) return null;
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v))) ? null : Math.round(Number(v));
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(j.score) || 0))),
    grade: String(j.grade || '').slice(0, 30),
    summary: String(j.summary || '').slice(0, 1600),
    highlights: j.highlights ? String(j.highlights).slice(0, 1000) : null,
    improvements: j.improvements ? String(j.improvements).slice(0, 1000) : null,
    pay_base: kind === 'month' ? num(j.pay_base) : null,
    pay_bonus: kind === 'month' ? num(j.pay_bonus) : null,
    pay_commission: kind === 'month' ? num(j.pay_commission) : null,
    pay_total: kind === 'month' ? num(j.pay_total) : null,
    pay_note: kind === 'month' && j.pay_note ? String(j.pay_note).slice(0, 1200) : null,
  };
}
function reviewPeriodFallback(kind, r) {
  const score = r.avg_day_score || 0;
  const grade = score >= 80 ? 'Výborný' : score >= 55 ? 'Dobrý' : score >= 30 ? 'Průměrný' : 'Slabý';
  return {
    score, grade,
    summary: `Průměrné denní skóre ${score}, splněno ${r.tasks_done}/${r.tasks_total} úkolů, obrat ${r.revenue_period}, ${r.reservations_period} rezervací, ${r.conversions_period} konverzí.`,
    highlights: null, improvements: null,
    pay_base: null, pay_bonus: null, pay_commission: null, pay_total: null, pay_note: null,
  };
}
async function reviewPeriod(personId, kind, refStr) {
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { first_name: true, last_name: true } }).catch(() => null);
  const pName = person ? `${person.first_name || ''} ${person.last_name || ''}`.trim() : ('#' + personId);
  const result = await gatherPeriodResult(personId, kind, refStr);
  let out = await reviewPeriodAI({ name: pName }, kind, result);
  if (!out) out = reviewPeriodFallback(kind, result);
  const { start, end } = periodBounds(kind, refStr);
  const review = await prisma.salesReview.upsert({
    where: { person_id_kind_period_start: { person_id: personId, kind, period_start: start } },
    create: { person_id: personId, kind, period_start: start, period_end: end, score: out.score, grade: out.grade, summary: out.summary, highlights: out.highlights, improvements: out.improvements, metrics: result, pay_currency: PAY_CURRENCY, pay_base: out.pay_base, pay_bonus: out.pay_bonus, pay_commission: out.pay_commission, pay_total: out.pay_total, pay_note: out.pay_note },
    update: { period_end: end, score: out.score, grade: out.grade, summary: out.summary, highlights: out.highlights, improvements: out.improvements, metrics: result, pay_currency: PAY_CURRENCY, pay_base: out.pay_base, pay_bonus: out.pay_bonus, pay_commission: out.pay_commission, pay_total: out.pay_total, pay_note: out.pay_note, generated_at: new Date() },
  });
  return review;
}

// ─── Denní report majitelům (Jan + Tomáš) ─────────────────────────────────────
// Souhrn za celý tým: jaké úkoly/cíle agent zadal, co se splnilo, hodnocení
// spolupráce obchodníků. Posílá push + zvonek a vytvoří čitelnou položku ve Velíně.
async function buildOwnerReport(dateStr) {
  const people = await getActiveSalespeople();
  const date = dayDate(dateStr);
  const per = [];
  for (const p of people) {
    const plan = await prisma.salesDayPlan.findUnique({ where: { person_id_date: { person_id: p.id, date } }, include: { tasks: true } }).catch(() => null);
    const review = await prisma.salesReview.findUnique({ where: { person_id_kind_period_start: { person_id: p.id, kind: 'day', period_start: date } } }).catch(() => null);
    const tasks = plan ? plan.tasks : [];
    const targets = await getTargets(p.id);
    const actuals = await computeActuals(p.id);
    per.push({
      person_id: p.id, name: p.name,
      focus: plan ? plan.focus : null,
      tasks_assigned: tasks.length,
      tasks_done: tasks.filter((t) => t.status === 'done').length,
      tasks_skipped: tasks.filter((t) => t.status === 'skipped').length,
      tasks_open: tasks.filter((t) => t.status === 'open').length,
      day_score: review ? review.score : null,
      day_summary: review ? (review.summary || '') : null,
      month_target_revenue: (targets.revenue && targets.revenue.month) || 0,
      month_actual_revenue: (actuals.revenue && actuals.revenue.month) || 0,
      month_target_reservations: (targets.reservations && targets.reservations.month) || 0,
      month_actual_reservations: (actuals.reservations && actuals.reservations.month) || 0,
    });
  }
  return { date: dateStr, team_size: people.length, per };
}
async function ownerReportTextAI(report) {
  const sys = 'Jsi AI vedoucí obchodu Best Series a podáváš KRÁTKÝ denní report majitelům firmy (Jan a Tomáš Holý). Shrň za celý obchodní tým: jaké úkoly a cíle jsi dnes zadal, co se z toho splnilo, a férově zhodnoť spolupráci a výkon jednotlivých obchodníků (kdo táhne, kdo zaostává). Buď věcný, konkrétní, bez vaty. Odpověz POUZE platným JSON bez markdownu: {"headline":"<1 věta souhrn dne>","body":"<report v čistém textu, klidně s odrážkami přes • a novými řádky, česky>"}. Piš česky.';
  const usr = 'Denní data týmu (JSON):\n' + JSON.stringify(report);
  const j = await callClaudeJSON(sys, usr, 1200);
  if (!j) return null;
  return { headline: String(j.headline || '').slice(0, 300), body: String(j.body || '').slice(0, 4000) };
}
function ownerReportTextFallback(report) {
  const lines = [];
  let totA = 0; let totD = 0;
  report.per.forEach((p) => {
    totA += p.tasks_assigned; totD += p.tasks_done;
    lines.push(`• ${p.name}: zadáno ${p.tasks_assigned} úkolů, splněno ${p.tasks_done}` + (p.day_score != null ? `, skóre ${p.day_score}` : '') + (p.month_target_revenue ? ` | obrat měsíc ${p.month_actual_revenue}/${p.month_target_revenue}` : ''));
  });
  return { headline: `Tým ${report.team_size} obch.: zadáno ${totA} úkolů, splněno ${totD}.`, body: lines.join('\n') || 'Dnes bez aktivních obchodníků.' };
}
async function reportToOwners(dateStr) {
  const ds = dateStr || tzTodayStr();
  const report = await buildOwnerReport(ds);
  let txt = await ownerReportTextAI(report);
  if (!txt) txt = ownerReportTextFallback(report);
  const title = '🧭 Report AI vedoucího obchodu — ' + txt.headline;
  const body = fmtCz(dayDate(ds)) + '\n\n' + txt.body;
  try {
    const notify = require('../compounder/notify');
    await notify.notifyOwnersMessage(prisma, { title, body, data: { type: 'sales_manager_report', date: ds } });
  } catch (e) { console.error('[sales-manager] owner report notify:', e.message); }
  return { ok: true, title, body, report };
}

module.exports = {
  tzTodayStr, periodBounds, getActiveSalespeople,
  planDay, reviewDay, reviewPeriod, reportToOwners,
  buildOwnerReport, computeActuals, getTargets,
};
