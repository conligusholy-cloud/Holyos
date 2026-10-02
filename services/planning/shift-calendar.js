// =============================================================================
// HolyOS — Plánovač: shift-aware time math
// =============================================================================
//
// Pomocný modul pro RCCP V2 scheduler. Počítá s pracovní dobou (shift) a
// pracovními dny. Pokud env není nastavený, fallback je 24/7 — chování je
// tedy backward-compatible s V1 naive schedulerem.
//
// Env proměnné:
//   SCHEDULER_SHIFT_START   "HH:MM" lokálního času (např. "05:30")
//   SCHEDULER_SHIFT_END     "HH:MM" lokálního času (např. "14:00")
//   SCHEDULER_WORK_DAYS     CSV ISO dnů 1..7 (1=Po, 7=Ne; default "1,2,3,4,5")
//
// POZOR — TZ: funkce používají lokální čas serveru (getHours/setHours).
// Na produkci musí být `TZ=Europe/Prague` (jinak shift bude posunutý).
// Pokud někdy přejdeme na multi-TZ, je potřeba přepsat na explicit Intl API.
// =============================================================================

/**
 * Načti konfiguraci ze env. Pokud start nebo end chybí, modul je vypnut.
 */
// Výchozí směna (když není nic nastaveno): 5:30–14:00, Po–Pá, zákonné přestávky 30 min
// (ZP §88: nejdéle po 6 h práce; tady 2× 15 min — svačina 8:30 a oběd 11:00).
const DEFAULT_SHIFT = { start: '05:30', end: '14:00', work_days: [1, 2, 3, 4, 5], breaks: [{ start: '08:30', end: '08:45' }, { start: '11:00', end: '11:15' }] };

function normalizeConfig(raw) {
  const start = raw && raw.start ? String(raw.start) : null;
  const end = raw && raw.end ? String(raw.end) : null;
  let workDays = Array.isArray(raw && raw.work_days) ? raw.work_days.map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= 7) : null;
  if (workDays && !workDays.length) workDays = [1, 2, 3, 4, 5];
  const breaks = (Array.isArray(raw && raw.breaks) ? raw.breaks : [])
    .map(b => ({ start: parseTime(b.start), end: parseTime(b.end), s: b.start, e: b.end }))
    .filter(b => b.start && b.end && (b.end.h * 60 + b.end.m) > (b.start.h * 60 + b.start.m))
    .sort((a, b) => (a.start.h * 60 + a.start.m) - (b.start.h * 60 + b.start.m));
  return { start, end, workDays, breaks, enabled: !!(start && end && workDays && workDays.length > 0) };
}

/**
 * Konfigurace směny ze env (synchronně). Když env není, použije se DEFAULT_SHIFT.
 * Preferovaná cesta je loadShiftConfig() — čte AppSetting production.shift (⚙️ Nastavení výroby).
 */
function getShiftConfig(env = process.env) {
  if (env.SCHEDULER_SHIFT_START && env.SCHEDULER_SHIFT_END) {
    return normalizeConfig({ start: env.SCHEDULER_SHIFT_START, end: env.SCHEDULER_SHIFT_END, work_days: (env.SCHEDULER_WORK_DAYS || '1,2,3,4,5').split(','), breaks: DEFAULT_SHIFT.breaks });
  }
  if (String(env.SCHEDULER_SHIFT_24_7 || '') === '1') return { start: null, end: null, workDays: null, breaks: [], enabled: false };
  return normalizeConfig(DEFAULT_SHIFT);
}

/** Asynchronně: AppSetting production.shift → env → výchozí. */
async function loadShiftConfig() {
  try {
    const { getSetting } = require('../settings');
    const raw = await getSetting('production.shift', { type: 'json', defaultValue: null });
    if (raw && raw.start && raw.end) return normalizeConfig(raw);
    if (raw && raw.mode === '24_7') return { start: null, end: null, workDays: null, breaks: [], enabled: false };
  } catch (e) { /* bez DB → env/default */ }
  return getShiftConfig();
}

/** Parse 'HH:MM' -> { h, m }, vrátí null při chybě. */
function parseTime(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

/** ISO day of week: 1=Po..7=Ne (JS getDay() vrací 0=Ne..6=So). */
function isoDow(date) {
  const d = date.getDay();
  return d === 0 ? 7 : d;
}

/** Vrátí kopii date s nastavenou hodinou/minutou (lokální TZ), sekundy/ms=0. */
function withTimeOfDay(date, h, m) {
  const out = new Date(date);
  out.setHours(h, m, 0, 0);
  return out;
}

/** Vrátí Date posunutý o N dní (lokální TZ, zachovává čas dne). */
function addDays(date, n) {
  const out = new Date(date);
  out.setDate(out.getDate() + n);
  return out;
}

/**
 * Je `date` uvnitř pracovní doby v pracovní den?
 */
function isInShift(date, cfg) {
  if (!cfg.enabled) return true;
  if (!cfg.workDays.includes(isoDow(date))) return false;
  const s = parseTime(cfg.start);
  const e = parseTime(cfg.end);
  if (!s || !e) return true;
  const shiftStart = withTimeOfDay(date, s.h, s.m);
  const shiftEnd = withTimeOfDay(date, e.h, e.m);
  if (!(date >= shiftStart && date < shiftEnd)) return false;
  // Přestávky = mimo pracovní čas
  for (const br of cfg.breaks || []) {
    const bs = withTimeOfDay(date, br.start.h, br.start.m), be = withTimeOfDay(date, br.end.h, br.end.m);
    if (date >= bs && date < be) return false;
  }
  return true;
}

/** Nejbližší konec pracovního úseku po `date` (konec směny nebo začátek přestávky). */
function currentSegmentEnd(date, cfg) {
  const e = parseTime(cfg.end);
  let segEnd = withTimeOfDay(date, e.h, e.m);
  for (const br of cfg.breaks || []) {
    const bs = withTimeOfDay(date, br.start.h, br.start.m);
    if (bs > date && bs < segEnd) segEnd = bs;
  }
  return segEnd;
}

/**
 * Najde nejbližší začátek shiftu ≥ `from`. Pokud `from` už je v shiftu,
 * vrátí `from` (beze změny).
 *
 * Bezpečnost: kdyby všechny dny byly nepracovní (config bug), vrací po
 * 14 iteracích původní `from` aby se neuvázl scheduler.
 */
function nextShiftStart(from, cfg) {
  if (!cfg.enabled) return new Date(from);

  if (isInShift(from, cfg)) return new Date(from);

  const s = parseTime(cfg.start);
  const e = parseTime(cfg.end);
  if (!s) return new Date(from);

  let cursor = new Date(from);
  for (let i = 0; i < 14; i++) {
    if (cfg.workDays.includes(isoDow(cursor))) {
      const shiftStart = withTimeOfDay(cursor, s.h, s.m);
      if (cursor < shiftStart) return shiftStart;
      // Uvnitř směny v přestávce → konec přestávky
      const shiftEnd = e ? withTimeOfDay(cursor, e.h, e.m) : null;
      if (shiftEnd && cursor < shiftEnd) {
        for (const br of cfg.breaks || []) {
          const bs = withTimeOfDay(cursor, br.start.h, br.start.m), be = withTimeOfDay(cursor, br.end.h, br.end.m);
          if (cursor >= bs && cursor < be) return be;
        }
      }
      // Jsme v pracovní den po konci shiftu -> zkus zítra
    }
    cursor = addDays(cursor, 1);
    cursor.setHours(0, 0, 0, 0);
  }
  // Pojistka — fallback na původ
  return new Date(from);
}

/**
 * Spotřebuje `minutes` minut počínaje od `start`. Pokud potřebuje, posouvá
 * se přes mimo-shiftové úseky (víkendy, večery, brzké ráno).
 *
 * Vrací { end, wait_minutes } — wait_minutes je čas strávený mimo shift
 * (čekání mezi shifty), tj. tunelové minuty které nepočítají do "work".
 *
 * Pro vypnutý shift (cfg.enabled=false) vrací prostý start + minutes (24/7).
 */
function consumeShift(start, minutes, cfg) {
  if (minutes <= 0) {
    return { end: new Date(start), wait_minutes: 0 };
  }
  if (!cfg.enabled) {
    return {
      end: new Date(start.getTime() + minutes * 60_000),
      wait_minutes: 0,
    };
  }

  const e = parseTime(cfg.end);
  if (!e) {
    return {
      end: new Date(start.getTime() + minutes * 60_000),
      wait_minutes: 0,
    };
  }

  let cursor = nextShiftStart(start, cfg);
  let wait = Math.max(0, (cursor.getTime() - start.getTime()) / 60_000);
  let remaining = minutes;

  // Bezpečnostní limit — neměl by se nikdy spustit (ale defensive).
  for (let i = 0; i < 2000; i++) {
    // Pracovní úsek = do konce směny nebo do začátku nejbližší přestávky
    const segEnd = currentSegmentEnd(cursor, cfg);
    const availableMin = (segEnd.getTime() - cursor.getTime()) / 60_000;

    if (remaining <= availableMin) {
      const end = new Date(cursor.getTime() + remaining * 60_000);
      return { end, wait_minutes: +wait.toFixed(2) };
    }

    remaining -= availableMin;
    // Skok přes přestávku / večer / víkend na další pracovní čas
    const beyond = new Date(segEnd.getTime() + 1);
    const nextStart = nextShiftStart(beyond, cfg);
    wait += (nextStart.getTime() - segEnd.getTime()) / 60_000;
    cursor = nextStart;
  }

  // Pojistka při bug v configu — nikdy by sem nemělo dojít
  return {
    end: new Date(cursor.getTime() + remaining * 60_000),
    wait_minutes: +wait.toFixed(2),
    overflow: true,
  };
}

/** Nejbližší konec pracovního času ≤ `from` (pro počítání zpět): konec směny / konec přestávky / předchozí den. */
function prevShiftEnd(from, cfg) {
  if (!cfg.enabled) return new Date(from);
  if (isInShift(from, cfg)) return new Date(from);
  const s = parseTime(cfg.start), e = parseTime(cfg.end);
  let cursor = new Date(from);
  for (let i = 0; i < 14; i++) {
    if (cfg.workDays.includes(isoDow(cursor))) {
      const shiftStart = withTimeOfDay(cursor, s.h, s.m), shiftEnd = withTimeOfDay(cursor, e.h, e.m);
      if (cursor > shiftEnd) return shiftEnd;
      if (cursor >= shiftStart && cursor <= shiftEnd) {
        // v přestávce → začátek přestávky
        for (const br of cfg.breaks || []) { const bs = withTimeOfDay(cursor, br.start.h, br.start.m), be = withTimeOfDay(cursor, br.end.h, br.end.m); if (cursor >= bs && cursor < be) return bs; }
        return cursor;
      }
      // před začátkem směny → předchozí pracovní den (konec směny)
    }
    cursor = addDays(cursor, -1);
    cursor.setHours(23, 59, 59, 0);
  }
  return new Date(from);
}
/** Začátek aktuálního pracovního úseku ≤ date (začátek směny nebo konec předchozí přestávky). */
function currentSegmentStart(date, cfg) {
  const s = parseTime(cfg.start);
  let segStart = withTimeOfDay(date, s.h, s.m);
  for (const br of cfg.breaks || []) { const be = withTimeOfDay(date, br.end.h, br.end.m); if (be <= date && be > segStart) segStart = be; }
  return segStart;
}
/**
 * Odečte `minutes` pracovních minut od `end` směrem ZPĚT (přes přestávky, večery, víkendy).
 * Použití: do kdy musí být materiál připravený, aby operace mohla začít v `end`.
 */
function subtractShift(end, minutes, cfg) {
  if (minutes <= 0) return new Date(end);
  if (!cfg.enabled) return new Date(end.getTime() - minutes * 60_000);
  let cursor = prevShiftEnd(end, cfg);
  let remaining = minutes;
  for (let i = 0; i < 2000; i++) {
    const segStart = currentSegmentStart(cursor, cfg);
    const availableMin = (cursor.getTime() - segStart.getTime()) / 60_000;
    if (remaining <= availableMin) return new Date(cursor.getTime() - remaining * 60_000);
    remaining -= availableMin;
    cursor = prevShiftEnd(new Date(segStart.getTime() - 1), cfg);
  }
  return new Date(cursor.getTime() - remaining * 60_000);
}

module.exports = {
  getShiftConfig,
  subtractShift,
  prevShiftEnd,
  loadShiftConfig,
  normalizeConfig,
  DEFAULT_SHIFT,
  parseTime,
  isoDow,
  isInShift,
  nextShiftStart,
  consumeShift,
  withTimeOfDay,
  addDays,
};
