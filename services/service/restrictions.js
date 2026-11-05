// =============================================================================
// HolyOS — Aktuální omezení provozu (jediný zdroj pravdy)
// =============================================================================
// Odsud čte PŘEHLED „Aktuální omezení provozu" na Infolince (GET /api/service/restrictions)
// i hlasový AI agent během hovoru (services/voice/tools.js). Jedna logika filtrování
// pro obě místa — ať operátorka a AI nikdy neříkají zákazníkovi něco jiného.
//
// Co se považuje za aktivní omezení:
//   • ServiceRequest.show_infoline = true   (technik povolil „Zobrazit infolince")
//   • status ∈ {novy, reseni}               (NE vyřešeno / zamítnuto)
// Jakmile technik označí požadavek Vyřešeno, ze seznamu okamžitě zmizí.
//
// DŮLEŽITÉ: při chybě čtení z databáze vracíme available:false, NIKDY prázdný
// seznam. Prázdný seznam znamená „nic se neděje" a AI by podle něj zákazníkovi
// tvrdila, že je všechno v pořádku.

const { prisma } = require('../../config/database');

const ACTIVE_STATUSES = ['novy', 'reseni'];

const IMPACT_LABEL = {
  none: 'Bez omezení provozu',
  known: 'Známý problém – zařízení funguje',
  limited: 'Omezený provoz',
  out: 'Zařízení mimo provoz',
  site_out: 'Celý prádlomat mimo provoz',
};
const IMPACT_RANK = { site_out: 0, out: 1, limited: 2, known: 3, none: 9 };
const STATUS_LABEL = { novy: 'Nový', reseni: 'V řešení', vyreseno: 'Vyřešeno', zamitnuto: 'Zamítnuto' };

// ─── Párování lokality podle názvu (záloha, když chybí machine_id) ───────────
// Stroje se jmenují „Město - Provozovna - Zařízení" (Pardubice - Kaufland - Pračka).
// Při porovnávání proto musíme zahodit slova, která má v názvu KAŽDÁ lokalita:
// druh zařízení a název řetězce. Zbydou vlastní jména (město, značka provozovny)
// a ta teprve rozhodují.
//
// Proč to tak je: dřív stačilo jedno společné slovo delší než 4 znaky, a protože
// „pračka" je v názvu úplně všude, sedla si navzájem každá lokalita s každou.
// AI pak zákazníkovi v Pardubicích hlásila odstávku z Uherského Brodu.
const LOC_CHAINS = new Set(['tesco', 'albert', 'kaufland', 'lidl', 'penny', 'billa', 'globus', 'coop', 'obi', 'makro', 'interspar', 'spar', 'norma']);
const LOC_DEVICE = new Set(['pracka', 'pracky', 'pracce', 'pracek', 'susicka', 'susicky', 'susic', 'susice', 'susarna', 'mycka', 'automat', 'terminal', 'kiosek', 'kiosk', 'stroj', 'stroje']);
const LOC_FILLER = new Set(['ulice', 'namesti', 'nam', 'pradlomat', 'pradlomaty', 'parkoviste', 'cerpaci', 'stanice', 'obchodni', 'centrum', 'oc']);
const LOC_GENERIC = new Set([...LOC_CHAINS, ...LOC_DEVICE, ...LOC_FILLER]);

const locNorm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const locTokens = (t) => locNorm(t).split(/[^a-z0-9]+/).filter((x) => x.length >= 3);
// Vlastní jména lokality — co zbyde po vyhození zařízení, řetězců a výplně.
const locOwnTokens = (t) => locTokens(t).filter((x) => !LOC_GENERIC.has(x));
const locChains = (t) => new Set(locTokens(t).filter((x) => LOC_CHAINS.has(x)));

/**
 * Jde o tutéž lokalitu? Porovnává se jen to, co lokalitu opravdu odlišuje.
 * Když obě strany jmenují řetězec a každá jiný, je to jiná provozovna —
 * „Pardubice Kaufland" a „Pardubice Albert" nejsou totéž, i když je to stejné město.
 */
function locationMatches(a, b) {
  const na = locNorm(a).trim(), nb = locNorm(b).trim();
  if (!na || !nb) return false;
  if (na === nb) return true;

  const chA = locChains(na), chB = locChains(nb);
  if (chA.size && chB.size && ![...chA].some((x) => chB.has(x))) return false; // jiný řetězec = jiná provozovna

  const ta = locOwnTokens(na), tb = new Set(locOwnTokens(nb));
  if (!ta.length || !tb.size) {
    // Ani jedna strana nemá vlastní jméno (třeba jen „Tesco - Pračka") — na shodu to nestačí.
    return false;
  }
  const spolecne = ta.filter((x) => tb.has(x));
  if (!spolecne.length) return false;
  return spolecne.some((x) => x.length >= 4) || spolecne.length >= 2;
}

// Skóre shody názvu — čím víc, tím jistější. Používá se při hledání stroje
// podle toho, co zaznělo v hovoru („Tesco Rychnov"). Druh zařízení ani název
// řetězce skoro nic neváží — rozhoduje město a vlastní jméno provozovny.
function locationScore(machineName, spoken) {
  const nm = locNorm(machineName), ns = locNorm(spoken);
  if (!nm || !ns) return 0;
  if (nm === ns) return 100;
  const chM = locChains(nm), chS = locChains(ns);
  if (chM.size && chS.size && ![...chM].some((x) => chS.has(x))) return 0; // jiný řetězec
  let score = 0;
  if (nm.includes(ns) || ns.includes(nm)) score += 50;
  const tm = new Set(locTokens(nm));
  locTokens(ns).forEach((t) => {
    if (!tm.has(t)) return;
    if (LOC_DEVICE.has(t) || LOC_FILLER.has(t)) return;   // „pračka" o lokalitě nevypovídá nic
    score += LOC_CHAINS.has(t) ? 3 : 10;                   // „tesco" samo o sobě skoro nic
  });
  return score;
}

// Klíč provozovny: vlastní jména + řetězec, bez druhu zařízení. Jedna provozovna
// má v evidenci víc strojů („… - Pračka", „… - Sušička") a pro zákazníka je to
// jedno místo — musí se brát dohromady, jinak by byl výběr vždy „nejednoznačný".
function siteKey(name) {
  const vlastni = locOwnTokens(name).sort();
  const retezce = [...locChains(name)].sort();
  return vlastni.concat(retezce).join('|') || locNorm(name).trim();
}

// ─── Druh zařízení ───────────────────────────────────────────────────────────
// Rozlišení, které po nás chce zadání: celý prádlomat × jednotlivý stroj ×
// platební zařízení. Jede se podle názvu zařízení, který technik zapsal.
const DEVICE_KINDS = [
  { kind: 'payment', label: 'platební zařízení', re: /(platebn|terminal|mincovn|bankovk|zeton|platba|karta|kiosek|kiosk|automat na \w*minc)/ },
  { kind: 'washer', re: /(pracka|pracky|pracce|washer)/, label: 'pračka' },
  { kind: 'dryer', re: /(susic|susick|susarna|dryer)/, label: 'sušička' },
];

function classifyDevice(name) {
  const n = locNorm(name);
  for (const d of DEVICE_KINDS) if (d.re.test(n)) return d.kind;
  return 'other';
}

// ─── Načtení aktivních omezení ───────────────────────────────────────────────

const SELECT_FIELDS = {
  id: true, problem: true, action: true, description: true, impact: true, devices: true,
  infoline_note: true, impact_since: true, status: true, assignee_id: true, created_at: true,
  phone: true, machine_id: true,
};

// Syrové řádky z DB (bez filtru lokality) — sdílí route i AI.
async function loadActiveRows() {
  const rows = await prisma.serviceRequest.findMany({
    where: { show_infoline: true, status: { in: ACTIVE_STATUSES } },
    select: SELECT_FIELDS,
  });
  return rows;
}

// Převede řádek požadavku na položku omezení.
function toItem(r) {
  const devices = Array.isArray(r.devices) ? r.devices.filter(Boolean) : [];
  return {
    id: r.id,
    machine_id: r.machine_id || null,
    location: r.problem,
    action: r.action,
    problem: r.description || r.action || '',
    impact: r.impact,
    impact_label: IMPACT_LABEL[r.impact] || r.impact,
    devices,
    device_kinds: devices.map((d) => ({ name: d, kind: classifyDevice(d) })),
    site_out: r.impact === 'site_out',
    infoline_note: r.infoline_note,
    since: r.impact_since || r.created_at,
    status: r.status,
    status_label: STATUS_LABEL[r.status] || r.status,
    // Interní — do odpovědi pro zákazníka NIKDY nepatří (jméno technika).
    assignee_id: r.assignee_id || null,
  };
}

function sortBySeverity(items) {
  return items.sort((a, b) =>
    (IMPACT_RANK[a.impact] ?? 9) - (IMPACT_RANK[b.impact] ?? 9) ||
    new Date(b.since) - new Date(a.since));
}

function countBySeverity(items) {
  const counts = { total: items.length, site_out: 0, out: 0, limited: 0, known: 0 };
  items.forEach((r) => { if (counts[r.impact] != null) counts[r.impact]++; });
  return counts;
}

// Najde stroj podle ID, nebo (když ID není) podle toho, co zaznělo v hovoru.
// Vrací { machine, ambiguous } — ambiguous = víc lokalit se stejně dobrou shodou,
// to si AI musí u volajícího ujasnit, ne hádat.
async function resolveMachine({ machineId, location }) {
  if (machineId) {
    const m = await prisma.serviceMachine.findUnique({
      where: { id: Number(machineId) },
      select: { id: true, name: true, status: true, type: true },
    });
    if (!m) return { machine: null, ambiguous: false, siteIds: [] };
    // I při zadaném ID bereme celou provozovnu — stroje jedné lokality patří k sobě.
    const vse = await prisma.serviceMachine.findMany({ select: { id: true, name: true } }).catch(() => []);
    const klic = siteKey(m.name);
    const siteIds = vse.filter((x) => siteKey(x.name) === klic).map((x) => x.id);
    return { machine: m, ambiguous: false, siteIds: siteIds.length ? siteIds : [m.id] };
  }
  const spoken = String(location || '').trim();
  if (!spoken) return { machine: null, ambiguous: false };

  const all = await prisma.serviceMachine.findMany({ select: { id: true, name: true, status: true, type: true } });
  const scored = all
    .map((m) => ({ m, score: locationScore(m.name, spoken) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { machine: null, ambiguous: false, siteIds: [] };
  const best = scored[0];
  const tie = scored.filter((x) => x.score === best.score);
  // Víc strojů téže provozovny („… - Pračka", „… - Sušička") není nejednoznačnost —
  // zákazník mluví o místě, ne o jednom stroji. Nejednoznačné je to až tehdy,
  // když si stejně dobře sedly DVĚ RŮZNÉ provozovny (např. „Tesco" bez města).
  const klic = siteKey(best.m.name);
  const jinaProvozovna = tie.filter((x) => siteKey(x.m.name) !== klic);
  if (jinaProvozovna.length) {
    const kandidati = [];
    const videno = new Set();
    tie.forEach((x) => { const k = siteKey(x.m.name); if (!videno.has(k)) { videno.add(k); kandidati.push(x.m); } });
    return { machine: null, ambiguous: true, candidates: kandidati.slice(0, 5), siteIds: [] };
  }
  // Všechny stroje téže provozovny — omezení na kterémkoli z nich platí pro celé místo.
  const siteIds = all.filter((m) => siteKey(m.name) === klic).map((m) => m.id);
  return { machine: best.m, ambiguous: false, siteIds };
}

/**
 * getActiveRestrictions — aktivní omezení pro konkrétní prádlomat.
 *
 * @param {object} opts
 * @param {number} [opts.machineId]  ServiceMachine.id (preferované — spolehlivé)
 * @param {string} [opts.location]   co zaznělo v hovoru ("Tesco Rychnov"), když ID není
 * @returns {Promise<object>} vždy objekt s `available`; při chybě available:false
 */
async function getActiveRestrictions({ machineId = null, location = null } = {}) {
  try {
    const { machine, ambiguous, candidates, siteIds } = await resolveMachine({ machineId, location });

    if (ambiguous) {
      return {
        available: true,
        resolved: false,
        ambiguous: true,
        message: 'Lokalita není jednoznačná — je potřeba si ji upřesnit (město nebo přesnější označení).',
        candidates: (candidates || []).map((m) => ({ id: m.id, name: m.name })),
        items: [],
      };
    }
    if (!machine && !location) {
      return { available: true, resolved: false, message: 'Nebyla zadána lokalita.', items: [] };
    }

    const rows = await loadActiveRows();
    const name = machine ? machine.name : String(location || '');
    const id = machine ? machine.id : null;

    // Primárně podle ID provozovny. Název je záloha JEN pro požadavky zapsané ručně
    // (bez výběru stroje) a pro historická data z doby před zavedením machine_id —
    // požadavek s cizím machine_id se sem nikdy nesmí dostat, i kdyby se názvy podobaly.
    // Když lokalitu známe podle ID a požadavek má jiné ID, je to jiný prádlomat. Tečka.
    const idsProvozovny = (siteIds && siteIds.length) ? siteIds : (id != null ? [id] : []);
    const matched = [], rejected = [];
    rows.forEach((r) => {
      const byId = r.machine_id != null && idsProvozovny.indexOf(r.machine_id) > -1;
      const byName = r.machine_id == null && !!name && locationMatches(r.problem, name);
      if (byId || byName) matched.push(Object.assign(toItem(r), { _match: byId ? 'id' : 'nazev' }));
      else rejected.push({ id: r.id, machine_id: r.machine_id || null, location: r.problem, impact: r.impact });
    });
    const items = sortBySeverity(matched);

    const siteOut = items.filter((i) => i.site_out);
    const machineStatusOut = !!(machine && machine.status === 'mimo_provozu');

    return {
      available: true,
      resolved: !!machine,
      machine: machine ? { id: machine.id, name: machine.name, status: machine.status, type: machine.type } : null,
      matched_by: machine ? (id && items.some((i) => i.machine_id === id) ? 'id' : 'nazev') : 'nazev',
      location: name,
      site_out: siteOut.length > 0 || machineStatusOut,
      items,
      counts: countBySeverity(items),
      // Jednoznačná odpověď pro AI i pro log — prázdný seznam ≠ „nevím".
      no_restrictions: items.length === 0 && !machineStatusOut,
      message: items.length === 0 && !machineStatusOut ? 'Žádné evidované omezení' : null,
      // Diagnostika do technického logu hovoru (požadavek #130): kolik aktivních
      // požadavků se prošlo a které se k téhle lokalitě nehodily.
      diag: {
        scanned: rows.length,
        site_ids: idsProvozovny,
        matched: items.map((i) => ({ id: i.id, machine_id: i.machine_id, location: i.location, impact: i.impact, matched_by: i._match })),
        rejected,
      },
    };
  } catch (err) {
    // Nedostupnost dat ≠ žádné závady. Volající kód (a AI) to musí poznat.
    console.warn('[restrictions] načtení selhalo:', err.message);
    return {
      available: false,
      error: 'Údaje o omezeních provozu se teď nepodařilo načíst.',
      items: [],
    };
  }
}

/**
 * listActiveRestrictions — plochý seznam pro přehled na Infolince.
 * @param {object} opts { q, location }
 */
async function listActiveRestrictions({ q = '', location = '' } = {}) {
  const rows = await loadActiveRows();
  let out = rows.map(toItem);
  const query = String(q || '').trim();
  if (query) {
    const nq = locNorm(query);
    out = out.filter((r) => locNorm(r.location + ' ' + r.devices.join(' ') + ' ' + (r.problem || '') + ' ' + (r.infoline_note || '')).includes(nq));
  }
  const loc = String(location || '').trim();
  if (loc) out = out.filter((r) => locationMatches(r.location, loc));
  sortBySeverity(out);
  return { items: out, counts: countBySeverity(out) };
}

module.exports = {
  getActiveRestrictions,
  listActiveRestrictions,
  loadActiveRows,
  resolveMachine,
  classifyDevice,
  locationMatches,
  locationScore,
  locNorm,
  toItem,
  ACTIVE_STATUSES,
  IMPACT_LABEL,
  IMPACT_RANK,
  STATUS_LABEL,
};
