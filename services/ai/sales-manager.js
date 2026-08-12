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
const { getSetting } = require('../settings');

// Editovatelné pokyny AI (filozofie + priority dne) — dají se měnit v nastavení HolyOS
// bez nasazení. Technický rámec (dělba práce + formát výstupu) zůstává v kódu, ať se plán nerozbije.
const AI_PLAN_INSTRUCTIONS_KEY = 'sales.ai_plan_instructions';
const AI_PLAN_INSTRUCTIONS_DEFAULT = 'ROLE: Jsi špičkový, náročný, důsledný, ale férový AI Sales Director firmy Best Series. Řídíš obchodníka prodávajícího prémiové samoobslužné prádelny "Compounder" jako podnikatelské a investiční aktivum. Nejsi pasivní plánovač úkolů — tvým cílem NENÍ vytvářet úkoly, ale PRODÁVAT Compoundery: maximalizovat uzavřené obchody, hodnotu prodejů, konverzi a rychlost obchodního procesu, důsledný follow-up, novou pipeline a plnou obchodní vytíženost obchodníka. '
  + 'PRIORITY (při konfliktu vždy v tomto pořadí): P1 CLOSE — dnes lze získat podpis/objednávku/rezervaci/platbu; P2 ADVANCE — významně posunout aktivní obchod; P3 DEADLINE — lead vyžaduje kontakt kvůli obchodní lhůtě (poslední den rozhodovací lhůty = closingový hovor); P4 MEETING — příprava a domlouvání schůzek; P5 NOVÝ LEAD — bleskové zpracování nových příchozích leadů (nové leady nesmí čekat); P6 FOLLOW-UP — povinné návazné kontakty; P7 PROSPECTING — tvorba nové pipeline; P8 ADMIN — jen nezbytná administrativa (administrativa NENÍ obchodní výkon). '
  + 'SCHŮZKY jsou pevné body dne — plán se staví kolem nich: u každé dnešní schůzky příprava a jednoznačný obchodní cíl a požadovaný výsledek; kontroluj i schůzky na 7 dní dopředu (potvrzení, podklady, nabídka, argumentace). '
  + 'SIGNÁLY ZÁJMU: hledej nákupní signály (opakované návštěvy portálu, prohlížení ceny/ekonomiky/návratnosti, blížící se deadline, rezervace, žádost o financování) a podle nich zvyšuj prioritu — nečekej mechanicky na konec lhůty. '
  + 'PLNÝ DEN: obchodní den musí být plně vytížený. Po schůzkách, horkých leadech, lhůtách a follow-upech patří VŠECHEN zbývající čas aktivnímu prodeji — nikdy prázdný ani pohodlný den. Prospecting zadávej konkrétně s čísly a měř VÝSLEDKY (počet oslovení, dovolaných rozhovorů, kvalifikovaných kontaktů, domluvených schůzek), ne jen počet aktivit. '
  + 'MINDSET: každé ráno se ptej „Co musí tento obchodník dnes udělat, aby byla pravděpodobnost dalšího prodaného Compounderu co nejvyšší?" a podle toho postav den. Buď náročný, ale objektivní — rozlišuj nedostatek aktivity obchodníka od špatné kvality leadů či nízké konverze. Žádný aktivní lead nesmí zůstat bez dalšího konkrétního kroku a termínu; „ozveme se / uvidíme / promyslí si to" nejsou platné výsledky. ';
// Needitovatelný technický rámec — bez něj by se plán rozbil (řídí dělbu práce a formát výstupu).
const AI_PLAN_FRAMEWORK = 'DŮLEŽITÉ – DĚLBA PRÁCE: konkrétní existující kontakty (hovory, schůzky, pozvánky, oživení, dotažení rezervací) NEŘEŠÍŠ a NEVYPISUJEŠ — ty doplní systém automaticky jako samostatné úkoly, jeden úkol na jeden kontakt. Ty vracíš POUZE: (1) krátké zaměření dne (focus) a (2) 2–4 NÁBOROVÉ/kvótové úkoly BEZ konkrétního kontaktu (kind "prospecting" nebo "meeting", lead_id VŽDY null) — např. „Oslov 15 nových potenciálních provozoven/investorů", „Domluv aspoň 3 nové schůzky". '
  + 'Pravidla: 1) NIKDY nevkládej lead_id ani konkrétní jména z kontextu — jen obecné náborové kvóty s čísly. 2) Odhad est_min uveď realisticky (dohromady cca 2–4 h na aktivní nábor); zbytek dne zaberou automatické úkoly na kontakty. 3) VŠE je jen pro tohoto obchodníka. '
  + 'Odpověz POUZE platným JSON bez markdownu ve tvaru: {"focus":"<1-2 věty zaměření dne, ať obchodník ví, na co dnes zabrat>","tasks":[{"kind":"<prospecting|meeting>","title":"<krátce, konkrétně, s číslem>","detail":"<co přesně udělat, 1-2 věty>","reasoning":"<proč, krátce>","priority":<3-4>,"est_min":<odhad minut>,"lead_id":null}]}. Piš česky.';

const TZ = process.env.VELIN_TZ || 'Europe/Prague';
const MODEL = process.env.SALES_MANAGER_MODEL || process.env.COMPOUNDER_LOCATION_MODEL || 'claude-sonnet-4-6';
// Záložní ověřený model — když primární selže (neplatný model / chyba), zkusíme tenhle.
const FALLBACK_MODEL = process.env.SALES_MANAGER_FALLBACK_MODEL || 'claude-haiku-4-5-20251001';

// Robustní vytažení JSONu z odpovědi (odstraní markdown ploty i případný text okolo).
function extractJson(text) {
  if (!text) return null;
  var t = String(text).replace(/^```(json)?/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch (e) { /* zkusíme vyříznout {...} níže */ }
  var s = t.indexOf('{'); var e = t.lastIndexOf('}');
  if (s !== -1 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch (e2) { /* vzdáváme */ } }
  return null;
}
const PAY_CURRENCY = process.env.SALES_PAY_CURRENCY || 'CZK';
// Pracovní kapacita: Po–Pá, 8 h/den (nastavitelné přes env).
const WORK_HOURS = Number(process.env.SALES_WORK_HOURS) || 8;
const WORK_MIN = Math.round(WORK_HOURS * 60);
// Prodejní trychtýř pro cíle — reálné B2B benchmarky pro velkou investiční
// položku (Compounder). Vše laditelné přes env. Logika: kontakty/den → schůzky →
// rezervace → prodeje → obrat (prodeje × cena obchodu).
const CONTACTS_PER_DAY = Number(process.env.SALES_CONTACTS_PER_DAY) || 12;
const RATE_CONTACT_MEETING = Number(process.env.SALES_RATE_CONTACT_MEETING) || 0.10;
const RATE_MEETING_RESERVATION = Number(process.env.SALES_RATE_MEETING_RESERVATION) || 0.30;
const RATE_RESERVATION_SALE = Number(process.env.SALES_RATE_RESERVATION_SALE) || 0.35;

function isWeekday(d) { const wd = d.getUTCDay(); return wd >= 1 && wd <= 5; }
function workingDaysInMonth(ref) {
  const r = ref || new Date(tzTodayStr() + 'T00:00:00Z');
  const y = r.getUTCFullYear(); const m = r.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  let n = 0;
  for (let day = 1; day <= last; day++) { if (isWeekday(new Date(Date.UTC(y, m, day)))) n++; }
  return n;
}
function workingDaysRemainingInMonth(ref) {
  const r = ref || new Date(tzTodayStr() + 'T00:00:00Z');
  const y = r.getUTCFullYear(); const m = r.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  let n = 0;
  for (let day = r.getUTCDate(); day <= last; day++) { if (isWeekday(new Date(Date.UTC(y, m, day)))) n++; }
  return Math.max(1, n);
}

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
  if (!process.env.ANTHROPIC_API_KEY) { console.error('[sales-manager] Chybí ANTHROPIC_API_KEY.'); return null; }
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // Zkus primární model; při chybě (např. neplatný model) fallback na ověřený.
  const models = [MODEL];
  if (models.indexOf(FALLBACK_MODEL) === -1) models.push(FALLBACK_MODEL);
  for (var i = 0; i < models.length; i++) {
    try {
      const msg = await client.messages.create({
        model: models[i], max_tokens: maxTokens || 1200, system: sys,
        messages: [{ role: 'user', content: usr }],
      });
      const text = (msg && msg.content && msg.content[0] && msg.content[0].text) || '';
      const parsed = extractJson(text);
      if (parsed) return parsed;
      console.error('[sales-manager] JSON se nepodařilo naparsovat (model ' + models[i] + ').');
    } catch (e) {
      console.error('[sales-manager] Claude selhal (model ' + models[i] + '):', e.message);
    }
  }
  return null;
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
    where: { owner_person_id: personId, is_test: false },
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

// ─── Osobní cíle: odhad z historie a rozpuštění na periody ────────────────────
async function gatherTargetHistory(personId) {
  const leads = await prisma.compounderLead.findMany({ where: { owner_person_id: personId, is_test: false }, select: { id: true, status: true, created_at: true, updated_at: true }, take: 10000 });
  const ids = leads.map((l) => l.id);
  let resv = [];
  if (ids.length) { try { resv = await prisma.locationReservation.findMany({ where: { lead_id: { in: ids } }, select: { created_at: true, purchase_price: true } }); } catch (e) { resv = []; } }
  const now = Date.now(); const d90 = now - 90 * 86400000; const yStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  const new90 = leads.filter((l) => l.created_at && new Date(l.created_at).getTime() >= d90).length;
  const convAll = leads.filter((l) => l.status === 'converted').length;
  const conv90 = leads.filter((l) => l.status === 'converted' && l.updated_at && new Date(l.updated_at).getTime() >= d90).length;
  const resv90 = resv.filter((r) => r.created_at && new Date(r.created_at).getTime() >= d90);
  const rev90 = resv90.reduce((s, r) => s + (r.purchase_price || 0), 0);
  const revYear = resv.filter((r) => r.created_at && new Date(r.created_at).getTime() >= yStart).reduce((s, r) => s + (r.purchase_price || 0), 0);
  const dealVals = resv.map((r) => r.purchase_price || 0).filter((v) => v > 0);
  const avgDeal = dealVals.length ? Math.round(dealVals.reduce((a, b) => a + b, 0) / dealVals.length) : 0;
  // Firemní průměrná hodnota obchodu (napříč všemi rezervacemi) — fallback, když
  // obchodník ještě nemá vlastní uzavřené obchody, aby obratový cíl nebyl 0.
  let companyAvgDeal = 0;
  try {
    const all = await prisma.locationReservation.findMany({ where: { purchase_price: { gt: 0 } }, select: { purchase_price: true }, take: 3000 });
    if (all.length) companyAvgDeal = Math.round(all.reduce((s, r) => s + (r.purchase_price || 0), 0) / all.length);
  } catch (e) { companyAvgDeal = 0; }
  const dealValue = avgDeal || companyAvgDeal || Number(process.env.SALES_DEFAULT_DEAL_VALUE) || 0;
  return { total_leads: leads.length, new_leads_90d: new90, conversions_all: convAll, conversions_90d: conv90, reservations_90d: resv90.length, revenue_90d: rev90, revenue_year: revYear, avg_deal_value: avgDeal, company_avg_deal_value: companyAvgDeal, deal_value_used: dealValue, working_days_month: workingDaysInMonth(), work_hours_per_day: WORK_HOURS };
}
async function planTargetsAI(person, hist) {
  const sys = 'Jsi AI vedoucí obchodu Best Series (prodej prémiových prádelen Compounder jako investice). Navrhni tomuto obchodníkovi REÁLNÉ, ale ambiciózní MĚSÍČNÍ cíle, vycházející z jeho historie a z pracovní kapacity Po–Pá, ' + WORK_HOURS + ' h/den (' + hist.working_days_month + ' pracovních dní v měsíci). Metriky: new_contacts (nové oslovené/získané kontakty za měsíc), conversions (převedené obchody), reservations (rezervace lokalit), revenue (obrat v ' + PAY_CURRENCY + '). Zásady: cíle musí být splnitelné v 8h denní kapacitě (počítej reálné časy na hovor/schůzku/nábor), ale mají tlačit na maximum prodeje. Když je historie slabá, postav cíle hlavně na náboru a schůzkách (aktivita, kterou obchodník plně ovlivní). Revenue odhadni z reservations × hodnota obchodu — použij deal_value_used (vlastní průměr obchodníka, jinak firemní průměr); revenue NESMÍ být 0, pokud existuje jakákoli hodnota obchodu. Odpověz POUZE platným JSON bez markdownu: {"new_contacts":<číslo/měsíc>,"conversions":<číslo/měsíc>,"reservations":<číslo/měsíc>,"revenue":<číslo/měsíc>,"rationale":"<1-2 věty česky proč>"}. Piš česky.';
  const usr = 'Obchodník: ' + person.name + '\nHistorie a kapacita (JSON):\n' + JSON.stringify(hist);
  const j = await callClaudeJSON(sys, usr, 500);
  if (!j) return null;
  const num = (v) => Math.max(0, Math.round(Number(v) || 0));
  return { new_contacts: num(j.new_contacts), conversions: num(j.conversions), reservations: num(j.reservations), revenue: num(j.revenue), rationale: String(j.rationale || '').slice(0, 400) };
}
// Reálné cíle z prodejního trychtýře (B2B benchmarky), NE z vymyšlených poměrů.
function computeBenchmarkTargets(hist) {
  const wd = hist.working_days_month || 21;
  const price = hist.deal_value_used || hist.company_avg_deal_value || hist.avg_deal_value || Number(process.env.SALES_DEFAULT_DEAL_VALUE) || 0;
  const contacts = CONTACTS_PER_DAY * wd;
  const meetings = Math.round(contacts * RATE_CONTACT_MEETING);
  const reservations = Math.max(1, Math.round(meetings * RATE_MEETING_RESERVATION));
  const sales = Math.max(1, Math.round(reservations * RATE_RESERVATION_SALE));
  const revenue = sales * price;
  const pct = (r) => Math.round(r * 100);
  return {
    new_contacts: contacts, conversions: sales, reservations, revenue,
    rationale: CONTACTS_PER_DAY + ' kontaktů/den × ' + wd + ' dní = ' + contacts + '; ' + pct(RATE_CONTACT_MEETING) + '% → ' + meetings + ' schůzek; ' + pct(RATE_MEETING_RESERVATION) + '% → ' + reservations + ' rezervací; ' + pct(RATE_RESERVATION_SALE) + '% → ' + sales + ' prodejů × ' + price + ' = obrat.',
  };
}
// Ponecháno pro případné budoucí použití; cíle nyní počítáme deterministicky.
function targetsFallback(hist) { return computeBenchmarkTargets(hist); }
async function saveTargets(personId, month) {
  const wd = workingDaysInMonth();
  const per = {};
  PLAN_METRICS.forEach((m) => {
    const mv = Math.max(0, Math.round(month[m] || 0));
    per[m] = { month: mv, day: Math.ceil(mv / wd), week: Math.ceil(mv / 4.345), year: mv * 12 };
  });
  for (const m of PLAN_METRICS) {
    for (const p of PLAN_PERIODS) {
      await prisma.salesTarget.upsert({ where: { person_id_metric_period: { person_id: personId, metric: m, period: p } }, update: { value: per[m][p] }, create: { person_id: personId, metric: m, period: p, value: per[m][p] } }).catch(() => {});
    }
  }
  return per;
}
async function ensureTargets(personId, opts) {
  const existing = await getTargets(personId);
  // Cíle považujeme za nastavené jen když mají nenulový obrat i počet nových kontaktů —
  // jinak (např. staré cíle s obratem 0) se automaticky přepočítají.
  const has = existing && existing.new_contacts && existing.new_contacts.month > 0 && existing.revenue && existing.revenue.month > 0;
  if (has && !(opts && opts.force)) return existing;
  // Deterministicky z prodejního trychtýře (průhledné, doložitelné, ne AI odhad).
  const hist = await gatherTargetHistory(personId);
  const month = computeBenchmarkTargets(hist);
  await saveTargets(personId, month);
  return getTargets(personId);
}

// ─── Kontext pro plánování dne ────────────────────────────────────────────────
async function gatherPlanContext(personId) {
  const leads = await prisma.compounderLead.findMany({
    where: { owner_person_id: personId, is_test: false },
    select: {
      id: true, name: true, email: true, phone: true, role: true, lang: true, status: true,
      notes: true, activity_log: true, created_at: true, updated_at: true, source: true,
      access_sent_count: true, access_last_sent_at: true, access_approved_at: true, last_called_at: true, discount_until: true,
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

  // Kdo už má přístup do portálu? Byl v portálu (portal_view) nebo se registroval
  // (register_success). Slouží k tomu, aby se nezakládal úkol „poslat přístup"
  // někomu, kdo přístup dávno má (i když se ručně neodeslala pozvánka).
  const portalSeen = new Set();
  if (leadIds.length) {
    try {
      const pv = await prisma.compounderEvent.findMany({
        where: { event: { in: ['portal_view', 'register_success'] }, OR: leadIds.map((id) => ({ props: { path: ['lead_id'], equals: id } })) },
        select: { props: true }, take: 20000,
      });
      pv.forEach((e) => { const lid = e.props && e.props.lead_id; if (lid != null) portalSeen.add(lid); });
    } catch (e) { /* best-effort */ }
  }

  // Nákupní signály za poslední 2 dny (opakované návštěvy portálu / prohlížení ceny a ekonomiky).
  const hotSignal = new Set();
  if (leadIds.length) {
    try {
      const since = new Date(Date.now() - 2 * 86400000);
      const recent = await prisma.compounderEvent.findMany({
        where: { created_at: { gte: since }, event: { in: ['portal_view', 'eco_open', 'eco_edit', 'section_view'] }, OR: leadIds.map((id) => ({ props: { path: ['lead_id'], equals: id } })) },
        select: { event: true, props: true }, take: 20000,
      });
      const cnt = {};
      recent.forEach((e) => { const lid = e.props && e.props.lead_id; if (lid == null) return; const c = (cnt[lid] = cnt[lid] || { views: 0, eco: false }); if (e.event === 'portal_view') c.views += 1; if (e.event === 'eco_open' || e.event === 'eco_edit') c.eco = true; });
      Object.keys(cnt).forEach((lid) => { const c = cnt[lid]; if (c.eco || c.views >= 2) hotSignal.add(Number(lid)); });
    } catch (e) { /* best-effort */ }
  }

  const nowMs = Date.now();
  const dayStartMs = dayDate(tzTodayStr()).getTime();
  const leadFacts = leads.slice(0, 120).map((l) => {
    const lastAct = l.activity_log ? lastActivityLines(l.activity_log, 4) : [];
    const daysSinceUpdate = l.updated_at ? Math.floor((nowMs - new Date(l.updated_at).getTime()) / 86400000) : null;
    // „Má přístup do portálu" = pozvánka odeslána / byl v portálu / registroval se /
    // schválen přístup / registrace z webu. Kdo přístup má, nedostává úkol na pozvánku.
    const hasPortalAccess = (l.access_sent_count || 0) > 0 || !!l.access_last_sent_at || !!l.access_approved_at || portalSeen.has(l.id) || l.source === 'web';
    return {
      id: l.id, name: l.name, status: l.status, role: l.role, lang: l.lang,
      has_phone: !!l.phone, has_email: !!l.email,
      called_today: !!(l.last_called_at && new Date(l.last_called_at).getTime() >= dayStartMs),
      discount_ends_today: !!(l.discount_until && new Date(l.discount_until).getTime() >= dayStartMs && new Date(l.discount_until).getTime() < dayStartMs + 86400000),
      discount_ended: !!(l.discount_until && new Date(l.discount_until).getTime() < dayStartMs),
      days_since_update: daysSinceUpdate,
      invite_sent: l.access_sent_count || 0,
      has_portal_access: hasPortalAccess,
      portal_opened: portalSeen.has(l.id),
      access_sent_days: l.access_last_sent_at ? Math.floor((nowMs - new Date(l.access_last_sent_at).getTime()) / 86400000) : null,
      age_days: l.created_at ? Math.floor((nowMs - new Date(l.created_at).getTime()) / 86400000) : null,
      never_called: !l.last_called_at,
      hot_signal: hotSignal.has(l.id),
      recent_activity: lastAct,
      notes: (l.notes || '').slice(0, 300),
      reservations: (resvByLead[l.id] || []).map((r) => ({ kiosk: r.kiosk_code, status: r.status, reserved_until: r.reserved_until, sign_until: r.sign_until, fee_until: r.fee_until })),
    };
  });

  // Předchozí den — nesplněné úkoly (přenést).
  const yStr = tzTodayStr(new Date(Date.now() - 86400000));
  const yPlan = await prisma.salesDayPlan.findUnique({ where: { person_id_date: { person_id: personId, date: dayDate(yStr) } }, include: { tasks: true } }).catch(() => null);
  let carryOver = yPlan ? yPlan.tasks.filter((t) => t.status === 'open').map((t) => ({ title: t.title, lead_id: t.lead_id, kind: t.kind })) : [];
  // Vyřaď přenesené úkoly odkazující na testovací kontakt (jinak by se test lead vrátil zpět do plánu).
  const coLeadIds = carryOver.map((t) => t.lead_id).filter(Boolean);
  if (coLeadIds.length) {
    const testLeads = await prisma.compounderLead.findMany({ where: { id: { in: coLeadIds }, is_test: true }, select: { id: true } }).catch(() => []);
    const testSet = new Set(testLeads.map((x) => x.id));
    carryOver = carryOver.filter((t) => !t.lead_id || !testSet.has(t.lead_id));
  }
  // Vyřaď přenesené úkoly „poslat přístup do portálu" u leadů, kteří přístup už mají
  // (jinak by se chybně vygenerovaný invite úkol vracel den co den).
  const accessibleIds = new Set(leadFacts.filter((l) => l.has_portal_access).map((l) => l.id));
  carryOver = carryOver.filter((t) => !(t.kind === 'invite' && t.lead_id && accessibleIds.has(t.lead_id)));

  // Kalendář — schůzky obchodníka (dnes + příštích 7 dní). Řídí strukturu dne.
  const todayStart = dayDate(tzTodayStr());
  const in7 = new Date(Date.now() + 7 * 86400000);
  let events = [];
  try {
    events = await prisma.salesEvent.findMany({
      where: { organizer_id: personId, start_at: { gte: todayStart, lte: in7 } },
      orderBy: { start_at: 'asc' }, take: 60,
      select: { title: true, start_at: true, end_at: true, location: true, event_type: true, compounder_lead_id: true },
    });
  } catch (e) { events = []; }
  const todayEndMs = todayStart.getTime() + 86400000;
  const fmtEv = (e) => ({
    title: e.title, when: e.start_at ? new Date(e.start_at).toISOString() : null,
    location: e.location || null, type: e.event_type || 'meeting', lead_id: e.compounder_lead_id || null,
  });
  const meetingsToday = events.filter((e) => e.start_at && new Date(e.start_at).getTime() < todayEndMs).map(fmtEv);
  const meetingsUpcoming = events.filter((e) => e.start_at && new Date(e.start_at).getTime() >= todayEndMs).slice(0, 20).map(fmtEv);

  const targets = await getTargets(personId);
  const actuals = await computeActuals(personId);
  const q = (m) => (targets[m] && targets[m].day) || 0;

  return {
    date: tzTodayStr(), leadCount: leads.length,
    capacity: { work_hours_per_day: WORK_HOURS, work_minutes_per_day: WORK_MIN, workdays: 'Po–Pá', working_days_left_this_month: workingDaysRemainingInMonth() },
    daily_quota: { new_contacts: q('new_contacts'), conversions: q('conversions'), reservations: q('reservations'), revenue: q('revenue') },
    meetings_today: meetingsToday, meetings_upcoming_7d: meetingsUpcoming,
    meetings_this_week_count: meetingsToday.length + meetingsUpcoming.filter((m) => { const d = new Date(m.when); return periodBounds('week').end.getTime() >= d.getTime(); }).length,
    leads: leadFacts, carry_over: carryOver, targets, actuals,
  };
}

// ─── planDay ───────────────────────────────────────────────────────────────
const TASK_KINDS = ['call', 'followup', 'invite', 'close', 'reservation', 'meeting', 'prospecting', 'admin', 'other'];
function sanitizeKind(k) { return TASK_KINDS.indexOf(String(k || '').toLowerCase()) >= 0 ? String(k).toLowerCase() : 'other'; }
function clampPriority(p) { const n = Math.round(Number(p) || 3); return Math.max(1, Math.min(5, n)); }
function clampMin(m) { const n = Math.round(Number(m) || 0); if (!n) return null; return Math.max(5, Math.min(WORK_MIN, n)); }

async function planDayAI(person, ctx) {
  let instr = AI_PLAN_INSTRUCTIONS_DEFAULT;
  try { const s = await getSetting(AI_PLAN_INSTRUCTIONS_KEY, { type: 'string', defaultValue: AI_PLAN_INSTRUCTIONS_DEFAULT }); if (s && String(s).trim()) instr = String(s); } catch (e) { /* fallback na default */ }
  const sys = instr + ' ' + AI_PLAN_FRAMEWORK;
  const usr = 'Obchodník: ' + person.name + '\nKontext (JSON):\n' + JSON.stringify(ctx);
  const j = await callClaudeJSON(sys, usr, 1600);
  if (!j || !Array.isArray(j.tasks)) return null;
  return {
    focus: String(j.focus || '').slice(0, 400),
    tasks: j.tasks.slice(0, 10).map((t) => ({
      kind: sanitizeKind(t.kind), title: String(t.title || '').slice(0, 480),
      detail: t.detail ? String(t.detail).slice(0, 1000) : null,
      reasoning: t.reasoning ? String(t.reasoning).slice(0, 800) : null,
      priority: clampPriority(t.priority),
      est_min: clampMin(t.est_min),
      lead_id: Number.isInteger(t.lead_id) ? t.lead_id : (Number(t.lead_id) > 0 ? Number(t.lead_id) : null),
    })).filter((t) => t.title),
  };
}
function planDayFallback(ctx) {
  const tasks = [];
  const cap = (ctx.capacity && ctx.capacity.work_minutes_per_day) || WORK_MIN;
  const dq = ctx.daily_quota || {};
  const newQuota = Math.max(8, dq.new_contacts || 0); // aspoň 8 oslovení/den
  // (A) Dnešní schůzky z kalendáře — příprava.
  (ctx.meetings_today || []).forEach((m) => {
    if (tasks.length >= 9) return;
    const t = m.when ? new Date(m.when) : null;
    const hh = t ? (('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2)) : '';
    tasks.push({ kind: 'meeting', title: 'Připrav schůzku' + (hh ? ' v ' + hh : '') + ' – ' + (m.title || 'schůzka'), detail: 'Projdi kontext, cíl schůzky a další krok k uzavření.' + (m.location ? ' Místo: ' + m.location + '.' : ''), reasoning: 'Dnešní schůzka z kalendáře.', priority: 1, est_min: 60, lead_id: m.lead_id || null });
  });
  // (B) Horké leady a lhůty.
  (ctx.leads || []).forEach((l) => {
    if (tasks.length >= 8) return;
    const r = (l.reservations || [])[0];
    if (r && (r.status === 'reserved' || r.status === 'active')) {
      tasks.push({ kind: 'close', title: 'Dotáhnout rezervaci ' + r.kiosk + ' – ' + l.name, detail: 'Hlídat podpis a poplatek, popohnat zákazníka.', reasoning: 'Běžící rezervace se lhůtou.', priority: 1, est_min: 45, lead_id: l.id });
    } else if (!l.has_portal_access && l.has_email) {
      tasks.push({ kind: 'invite', title: 'Poslat přístup do portálu – ' + l.name, detail: 'Odeslat přihlašovací odkaz a hned zavolat.', reasoning: 'Ještě nedostal pozvánku.', priority: 2, est_min: 20, lead_id: l.id });
    } else if ((l.days_since_update || 0) >= 7) {
      tasks.push({ kind: 'followup', title: 'Oživit kontakt – ' + l.name, detail: 'Zavolat/napsat, zjistit stav a posunout k schůzce.', reasoning: 'Přes týden beze změny.', priority: 3, est_min: 20, lead_id: l.id });
    }
  });
  // (C) Nábor a domlouvání schůzek — zaplní zbytek denní kapacity.
  let used = tasks.reduce((s, t) => s + (t.est_min || 0), 0);
  const rest = Math.max(120, cap - used); // aspoň 2 h na aktivní prodej
  const prospMin = Math.round(rest * 0.6);
  const meetMin = Math.round(rest * 0.25);
  const callMin = rest - prospMin - meetMin;
  tasks.push({ kind: 'prospecting', title: 'Oslov ' + newQuota + ' nových potenciálních zákazníků', detail: 'Vytipuj a kontaktuj nové provozovny/investory (telefon, e-mail, LinkedIn).', reasoning: 'Denní kvóta náboru — většina dne patří novým obchodům.', priority: 3, est_min: prospMin, lead_id: null });
  tasks.push({ kind: 'meeting', title: 'Domluv aspoň ' + Math.max(2, dq.reservations ? dq.reservations + 1 : 2) + ' nové schůzky', detail: 'Z oslovených kontaktů nasaď konkrétní termíny do kalendáře.', reasoning: 'Bez schůzek není prodej.', priority: 3, est_min: meetMin, lead_id: null });
  tasks.push({ kind: 'call', title: 'Zavolej 10 kontaktům z pipeline', detail: 'Projdi kontakty a aktivně je posuň k dalšímu kroku.', reasoning: 'Denní objem hovorů drží obchod v pohybu.', priority: 4, est_min: Math.max(30, callMin), lead_id: null });
  return { focus: 'Dnes (kapacita ' + Math.round(cap / 60) + ' h): nejdřív schůzky a lhůty, zbytek dne tvrdě do náboru a domlouvání schůzek dle denních kvót.', tasks: tasks.slice(0, 9) };
}

// Rozpad na jednotlivé kontakty: 1 lead = max 1 úkol (nejnaléhavější akce), vždy s lead_id
// → na obrazovce dostane tlačítko „Otevřít kontakt" a odškrtává se samostatně.
// Obchodník tak jede kontakt po kontaktu: otevře → přečte poznámky → zavolá → odškrtne.
function buildLeadTasks(ctx) {
  const tasks = [];
  const covered = new Set();
  // Leady s naplánovanou schůzkou/hovorem (dnes i v příštích dnech) — ty se dnes už nevolají.
  const scheduled = new Set();
  (ctx.meetings_today || []).concat(ctx.meetings_upcoming_7d || []).forEach((m) => { if (m && m.lead_id) scheduled.add(m.lead_id); });
  // (A) Dnešní schůzky z kalendáře — příprava, per kontakt.
  (ctx.meetings_today || []).forEach((m) => {
    const t = m.when ? new Date(m.when) : null;
    const hh = t ? (('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2)) : '';
    tasks.push({ kind: 'meeting', title: 'Schůzka' + (hh ? ' ' + hh : '') + ' – ' + (m.title || 'schůzka'), detail: 'Otevři kontakt, projdi poznámky a cíl schůzky; ukonči konkrétním dalším krokem.' + (m.location ? ' Místo: ' + m.location + '.' : ''), reasoning: 'Dnešní schůzka z kalendáře.', priority: 1, est_min: 60, lead_id: m.lead_id || null });
    if (m.lead_id) covered.add(m.lead_id);
  });
  // (B) Horké leady a lhůty + běžné kontakty — každý jako samostatný úkol.
  const calls = [];
  (ctx.leads || []).forEach((l) => {
    if (covered.has(l.id)) return;
    if (l.status === 'nelze_pouzit' || l.status === 'rejected') { covered.add(l.id); return; } // mrtvé leady do plánu nepatří
    const r = (l.reservations || [])[0];
    if (r && (r.status === 'reserved' || r.status === 'active')) {
      tasks.push({ kind: 'close', title: 'Dotáhnout rezervaci ' + r.kiosk + ' – ' + l.name, detail: 'Otevři kontakt, přečti poznámky; hlídej podpis/poplatek a popožeň zákazníka k uzavření.', reasoning: 'Běžící rezervace se lhůtou.', priority: 1, est_min: 30, lead_id: l.id }); covered.add(l.id); return;
    }
    // Přístup do portálu posílej JEN kontaktu, který už byl volaný a má zájem (stav „Kvalifikován").
    // Nikomu jinému se přístup automaticky nenabízí — cold/nové leady se nejdřív volají a kvalifikují.
    if (l.status === 'qualified' && !l.has_portal_access && l.has_email) {
      tasks.push({ kind: 'invite', title: 'Poslat přístup do portálu – ' + l.name, detail: 'Kontakt má po hovoru zájem — otevři kontakt a odešli přihlašovací odkaz do portálu.', reasoning: 'Kvalifikovaný zájemce zatím bez přístupu.', priority: 2, est_min: 10, lead_id: l.id }); covered.add(l.id); return;
    }
    if (l.called_today) { covered.add(l.id); return; } // dnes už volaný → dnešní hovor je hotový, neplánuj další
    if (scheduled.has(l.id) || l.status === 'schuzka' || l.status === 'schuzka_online') { covered.add(l.id); return; } // má domluvenou schůzku → dnes se nevolá
    // Dosledování: běží sleva. Volat až POSLEDNÍ den (končí akce), jinak během slevy nevoláme.
    if (l.status === 'dosledovani') {
      if (l.discount_ends_today) {
        tasks.push({ kind: 'call', title: 'Zavolej – DNES KONČÍ akce/sleva – ' + l.name, detail: 'Otevři kontakt: dnes je poslední den slevy. Zavolej, připomeň konec akce a dotáhni k rezervaci/schůzce.', reasoning: 'Poslední den slevy — dosledování.', priority: 1, est_min: 12, lead_id: l.id });
      } else if (l.discount_ended) {
        tasks.push({ kind: 'followup', title: 'Zavolej – akce/sleva už skončila – ' + l.name, detail: 'Otevři kontakt: sleva skončila. Zavolej, zjisti rozhodnutí a nabídni další krok.', reasoning: 'Dosledování po konci slevy.', priority: 2, est_min: 12, lead_id: l.id });
      } else if (l.hot_signal) {
        tasks.push({ kind: 'call', title: '🔥 Silný zájem – zavolej a uzavři – ' + l.name, detail: 'Otevři kontakt: vrací se na portál / prohlíží cenu a ekonomiku. Zavolej ještě dnes, využij zájem a tlač k rezervaci nebo schůzce — nečekej na konec slevy.', reasoning: 'Nákupní signály během dosledování — uzavírej dřív.', priority: 2, est_min: 12, lead_id: l.id });
      }
      covered.add(l.id); return; // jinak během běžící slevy se nevolá
    }
    // Nedovoláno: opakuj pokus; po 5 dnech poslední pokus (SMS) a zvaž „Nelze použít".
    if (l.status === 'nedovolano') {
      if ((l.days_since_update || 0) >= 5) {
        tasks.push({ kind: 'followup', title: 'Poslední pokus (SMS) + zvaž „Nelze použít" – ' + l.name, detail: 'Otevři kontakt: ' + (l.days_since_update || 0) + ' dní se nedaří dovolat. Zkus poslední kontakt jiným kanálem (SMS). Když ani teď nereaguje, přepni na „Nelze použít".', reasoning: '5+ dní nedovoláno — poslední pokus před vyřazením.', priority: 3, est_min: 8, lead_id: l.id });
      } else {
        tasks.push({ kind: 'call', title: 'Zkus znovu dovolat – ' + l.name, detail: 'Otevři kontakt: minule ses nedovolal. Zkus to znovu v jinou denní dobu.', reasoning: 'Nedovoláno — další pokus.', priority: 4, est_min: 8, lead_id: l.id });
      }
      covered.add(l.id); return;
    }
    // Nový lead bez prvního kontaktu → čím déle čeká, tím vyšší priorita (nové leady nesmí čekat).
    if (l.status === 'new' && l.never_called && l.has_phone && (l.age_days || 0) >= 1) {
      tasks.push({ kind: 'call', title: '⏰ Bezodkladně zavolej NOVÝ lead – ' + l.name, detail: 'Otevři kontakt: nový lead čeká ' + (l.age_days || 0) + ' dní na první kontakt. Zavolej hned a kvalifikuj — reakční doba rozhoduje.', reasoning: 'Nový lead ' + (l.age_days || 0) + ' dní bez prvního kontaktu.', priority: 1, est_min: 12, lead_id: l.id });
      covered.add(l.id); return;
    }
    // Odeslán přístup do portálu, ale zákazník tam (druhý den+) nebyl → zavolat, ověřit odkaz a rozhýbat.
    if (l.has_phone && !l.portal_opened && (l.status === 'access_sent' || (l.invite_sent || 0) > 0) && (l.access_sent_days == null || l.access_sent_days >= 1)) {
      tasks.push({ kind: 'call', title: 'Zavolej – ověř odkaz a rozhýbej – ' + l.name, detail: 'Otevři kontakt: poslali jsme přístup do portálu, ale zákazník tam ještě nebyl. Zavolej, ověř, že odkaz přišel, a pomoz mu se do portálu dostat / vzbudit zájem.', reasoning: 'Odeslán přístup, ale žádný pohyb na portálu.', priority: 2, est_min: 12, lead_id: l.id }); covered.add(l.id); return;
    }
    if ((l.days_since_update || 0) >= 7) {
      tasks.push({ kind: 'followup', title: 'Oživit kontakt – ' + l.name, detail: 'Otevři kontakt, přečti poznámky; zavolej, zjisti stav a posuň k schůzce/rezervaci.', reasoning: 'Přes týden beze změny.', priority: 3, est_min: 15, lead_id: l.id }); covered.add(l.id); return;
    }
    // Obecný „zavolej a kvalifikuj" jen pro RANÉ fáze (první kontakt) — ne pro už posunuté leady
    // (Odeslán přístup / Kvalifikován / Dosledování apod. řeší vlastní větve výše).
    if (l.has_phone && ['new', 'volat_pristi', 'contacted'].indexOf(l.status) >= 0) calls.push(l);
    else covered.add(l.id);
  });
  // (C) Běžné hovory z pipeline — per kontakt, do rozumné denní kvóty (ať den nepřeteče stovkami úkolů).
  const callQuota = Math.max(8, (ctx.daily_quota && ctx.daily_quota.new_contacts) || 10);
  calls.slice(0, callQuota).forEach((l) => {
    tasks.push({ kind: 'call', title: 'Zavolej a kvalifikuj – ' + l.name, detail: 'Otevři kontakt, přečti poznámky; zavolej a zjisti zájem. Při zájmu pošli přístup do portálu a domluv schůzku.', reasoning: 'Kontakt v pipeline k prvnímu kontaktu / posunu.', priority: 4, est_min: 12, lead_id: l.id }); covered.add(l.id);
  });
  return tasks;
}

// Vytvoří/aktualizuje denní plán a úkoly. force=true přegeneruje (smaže staré open AI úkoly).
async function planDay(personId, dateStr, opts) {
  const date = dayDate(dateStr);
  const person = { id: personId, name: (await prisma.person.findUnique({ where: { id: personId }, select: { first_name: true, last_name: true } }).then((p) => p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : ('#' + personId)).catch(() => '#' + personId)) };
  // Reálné osobní cíle nastav VŽDY (i když už dnešní plán existuje) — jinak by
  // obchodníci s dřívějším plánem zůstali bez cílů (obrat 0).
  await ensureTargets(personId).catch(() => {});
  const existing = await prisma.salesDayPlan.findUnique({ where: { person_id_date: { person_id: personId, date } }, include: { tasks: true } });
  if (existing && existing.tasks.length && !(opts && opts.force)) return { plan: existing, created: 0, skipped: true };

  const ctx = await gatherPlanContext(personId);
  const ai = await planDayAI(person, ctx);
  const fb = planDayFallback(ctx);
  // Zaměření dne z AI (jinak fallback).
  const focus = (ai && ai.focus) || fb.focus;
  // Úkoly na jednotlivé kontakty — deterministicky a spolehlivě (1 lead = 1 úkol s „Otevřít kontakt").
  let tasks = buildLeadTasks(ctx);
  // Náborové/kvótové úkoly BEZ konkrétního kontaktu (oslov X nových, domluv X schůzek) — z AI, jinak fallback.
  const AGG_KINDS = ['prospecting', 'meeting', 'admin', 'other'];
  let aggregate = (ai && Array.isArray(ai.tasks) ? ai.tasks : []).filter((t) => !t.lead_id && AGG_KINDS.indexOf(t.kind) >= 0);
  if (!aggregate.length) aggregate = fb.tasks.filter((t) => !t.lead_id && AGG_KINDS.indexOf(t.kind) >= 0);
  tasks = tasks.concat(aggregate);
  // Seřaď dle priority.
  tasks.sort((a, b) => (a.priority || 3) - (b.priority || 3));
  // „Přesné plánování": součet odhadů (est_min) nesmí přesáhnout denní fond. Držíme nejvyšší
  // priority; hraniční úkol ořízneme na zbytek fondu; přebytek (nejnižší priority) do plánu nedáme.
  const fundMin = (ctx.capacity && Number(ctx.capacity.work_minutes_per_day)) || WORK_MIN;
  let _acc = 0;
  const fitted = [];
  for (let i = 0; i < tasks.length; i++) {
    if (_acc >= fundMin) break;
    const t = tasks[i];
    let em = Number(t.est_min) || 0;
    if (em > 0 && _acc + em > fundMin) { em = Math.max(5, fundMin - _acc); t.est_min = em; }
    fitted.push(t);
    _acc += Math.max(0, em);
  }
  const out = { focus, tasks: fitted.slice(0, 40) };

  const plan = await prisma.salesDayPlan.upsert({
    where: { person_id_date: { person_id: personId, date } },
    create: { person_id: personId, date, generated_by: 'ai', focus: out.focus, status: 'published' },
    update: { focus: out.focus, generated_by: 'ai', generated_at: new Date() },
  });
  if (opts && opts.force) {
    // Regenerace: zahoď staré NESPLNĚNÉ úkoly (done/skipped historii nech), ať se nehromadí duplicity.
    await prisma.salesTask.deleteMany({ where: { day_plan_id: plan.id, status: 'open' } }).catch(() => {});
  }
  // Nevytvářej znovu úkol, který už dnes byl HOTOVÝ/PŘESKOČENÝ (jinak by po přegenerování „ožil").
  const doneToday = await prisma.salesTask.findMany({ where: { day_plan_id: plan.id, status: { in: ['done', 'skipped'] } }, select: { kind: true, lead_id: true, title: true } }).catch(() => []);
  const doneKeys = new Set(doneToday.map((t) => t.kind + ':' + (t.lead_id || 0) + ':' + (t.title || '')));
  let created = 0;
  for (const t of out.tasks) {
    if (doneKeys.has(t.kind + ':' + (t.lead_id || 0) + ':' + (t.title || ''))) continue; // už vyřízený dnes
    await prisma.salesTask.create({ data: { day_plan_id: plan.id, person_id: personId, lead_id: t.lead_id, kind: t.kind, title: t.title, detail: t.detail, reasoning: t.reasoning, priority: t.priority, est_min: t.est_min || null, status: 'open' } });
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
    where: { owner_person_id: personId, is_test: false },
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
  const sys = 'Jsi náročný AI vedoucí obchodu Best Series. Zhodnoť DNEŠNÍ výkon obchodníka podle zadaných úkolů a toho, co reálně splnil (splněné/přeskočené/nesplněné úkoly, poznámky, nové kontakty, konverze, aktivita). Klíčové pro skóre: kolik toho udělal pro PRODEJ — dodržel schůzky, aktivně naboroval nové kontakty a domlouval nové schůzky, posouval leady. Samotné "být zaneprázdněný" nestačí; oceňuj konkrétní prodejní akce a výsledky. Buď konkrétní a férový, pochval co se povedlo, ale jasně pojmenuj, co nedotáhl a co musí zítra přidat. Odpověz POUZE platným JSON bez markdownu: {"score":<0-100>,"grade":"<1 slovo: Výborný|Dobrý|Průměrný|Slabý>","summary":"<2-4 věty česky>","highlights":"<co se povedlo, 1-2 věty nebo prázdné>","improvements":"<co zítra zlepšit, 1-2 věty>"}. Piš česky.';
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
      month_target_new_contacts: (targets.new_contacts && targets.new_contacts.month) || 0,
      month_actual_new_contacts: (actuals.new_contacts && actuals.new_contacts.month) || 0,
      month_target_conversions: (targets.conversions && targets.conversions.month) || 0,
      month_actual_conversions: (actuals.conversions && actuals.conversions.month) || 0,
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

// ─── Náhrada přeskočeného úkolu ──────────────────────────────────────────────
// Když obchodník přeskočí úkol, uvolněný čas se nesmí ztratit: AI vymyslí nový
// úkol (nebo úkoly) na zhruba stejný počet minut a zohlední důvod přeskočení,
// aby nenavrhla to samé nebo něco, co je podle důvodu blokované.
// Fond dne může legitimně zkrátit JEN dovolená nebo lékař.
function isFundReducingReason(reason) {
  const r = String(reason || '').toLowerCase();
  return /dovolen|l[eé]ka[řr]|doktor|nemocn|marod|nemoc/.test(r);
}

async function replaceTaskAI(person, freedMin, reason, skippedTitle, ctx, openTitles) {
  const sys = 'Jsi náročný ale férový AI vedoucí obchodu Best Series (prodej prémiových samoobslužných prádelen "Compounder" jako investice). Obchodník právě PŘESKOČIL jeden úkol a uvolnil se mu čas. Tvým úkolem je ten čas ZNOVU ZAPLNIT prodejní prací — vymysli 1–3 NOVÉ konkrétní úkoly, jejichž součet est_min je co nejblíž zadanému uvolněnému času (nesmí zůstat prázdné okno). DŮLEŽITÉ: zohledni DŮVOD přeskočení — nenavrhuj to samé, co obchodník přeskočil, ani nic, co je podle jeho důvodu blokované. Preferuj aktivní prodej: nábor nových kontaktů (prospecting), telefonáty (call), domlouvání schůzek (meeting), follow-up. Nevytvářej duplicity k už otevřeným úkolům. Odpověz POUZE platným JSON bez markdownu: {"tasks":[{"kind":"call|prospecting|meeting|followup|admin|other","title":"<krátce, s číslem kde to dává smysl>","detail":"<co přesně udělat, 1-2 věty>","reasoning":"<proč, krátce>","priority":<1-5>,"est_min":<minuty>}]}. Součet est_min ať odpovídá uvolněnému času. Piš česky.';
  const usr = 'Obchodník: ' + person.name
    + '\nUvolněný čas k zaplnění (min): ' + freedMin
    + '\nPřeskočený úkol: ' + skippedTitle
    + '\nDŮVOD přeskočení (respektuj ho, nevracej blokované): ' + (reason || '—')
    + '\nDenní kvóty a dosavadní plnění: ' + JSON.stringify({ quota: ctx && ctx.daily_quota, actuals: ctx && ctx.actuals })
    + '\nUž otevřené úkoly (nevytvářej duplicity): ' + JSON.stringify(openTitles || []);
  const j = await callClaudeJSON(sys, usr, 800);
  if (!j || !Array.isArray(j.tasks) || !j.tasks.length) return null;
  return j.tasks.slice(0, 3).map((t) => ({
    kind: sanitizeKind(t.kind), title: String(t.title || '').slice(0, 480),
    detail: t.detail ? String(t.detail).slice(0, 1000) : null,
    reasoning: t.reasoning ? String(t.reasoning).slice(0, 800) : null,
    priority: clampPriority(t.priority),
    est_min: clampMin(t.est_min),
    lead_id: null,
  })).filter((t) => t.title);
}

async function replaceSkippedTask(skipped) {
  try {
    if (!skipped || !skipped.day_plan_id) return { replaced: false };
    const reason = String(skipped.skipped_reason || '').trim();
    // Dovolená/lékař: fond dne se legitimně krátí, nic nedoplňujeme.
    if (isFundReducingReason(reason)) return { replaced: false, absence: true };
    const freed = clampMin(skipped.est_min) || 30;
    const personId = skipped.person_id;
    const pName = await prisma.person.findUnique({ where: { id: personId }, select: { first_name: true, last_name: true } })
      .then((p) => p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : ('#' + personId)).catch(() => '#' + personId);
    let ctx = null; try { ctx = await gatherPlanContext(personId); } catch (e) { ctx = null; }
    const openTasks = await prisma.salesTask.findMany({ where: { day_plan_id: skipped.day_plan_id, status: 'open' }, select: { title: true } }).catch(() => []);
    const openTitles = openTasks.map((t) => t.title);
    let newTasks = await replaceTaskAI({ name: pName }, freed, reason, skipped.title, ctx, openTitles).catch(() => null);
    if (!newTasks || !newTasks.length) {
      // Fallback bez AI: jeden náborový úkol na uvolněný čas.
      newTasks = [{ kind: 'prospecting', title: 'Oslov nové potenciální zákazníky (náhrada za přeskočený úkol)', detail: 'Vytipuj a kontaktuj nové provozovny/investory na uvolněný čas.', reasoning: 'Uvolněný čas z přeskočeného úkolu jde do náboru — fond dne zůstává zachován.', priority: 3, est_min: freed, lead_id: null }];
    }
    const created = [];
    for (const t of newTasks) {
      const row = await prisma.salesTask.create({ data: { day_plan_id: skipped.day_plan_id, person_id: personId, lead_id: null, kind: t.kind, title: t.title, detail: t.detail, reasoning: t.reasoning, priority: t.priority, est_min: t.est_min || freed, status: 'open' } });
      created.push(row);
    }
    return { replaced: true, tasks: created };
  } catch (e) { return { replaced: false, error: String((e && e.message) || e) }; }
}

module.exports = {
  tzTodayStr, periodBounds, getActiveSalespeople,
  planDay, reviewDay, reviewPeriod, reportToOwners,
  buildOwnerReport, computeActuals, getTargets, ensureTargets,
  replaceSkippedTask,
  AI_PLAN_INSTRUCTIONS_KEY, AI_PLAN_INSTRUCTIONS_DEFAULT,
};
