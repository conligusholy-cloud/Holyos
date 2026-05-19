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
function getShiftConfig(env = process.env) {
  const start = env.SCHEDULER_SHIFT_START || null;
  const end = env.SCHEDULER_SHIFT_END || null;
  const workDaysRaw = env.SCHEDULER_WORK_DAYS || '1,2,3,4,5';

  let workDays = null;
  if (start && end) {
    workDays = workDaysRaw
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n) && n >= 1 && n <= 7);
    if (workDays.length === 0) workDays = [1, 2, 3, 4, 5];
  }

  return {
    start,             // 'HH:MM' nebo null
    end,               // 'HH:MM' nebo null
    workDays,          // [1..7] (ISO) nebo null
    enabled: !!(start && end && workDays && workDays.length > 0),
  };
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
  return date >= shiftStart && date < shiftEnd;
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
  if (!s) return new Date(from);

  let cursor = new Date(from);
  for (let i = 0; i < 14; i++) {
    if (cfg.workDays.includes(isoDow(cursor))) {
      const shiftStart = withTimeOfDay(cursor, s.h, s.m);
      if (cursor < shiftStart) return shiftStart;
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
  for (let i = 0; i < 500; i++) {
    const todayShiftEnd = withTimeOfDay(cursor, e.h, e.m);
    const availableMin = (todayShiftEnd.getTime() - cursor.getTime()) / 60_000;

    if (remaining <= availableMin) {
      const end = new Date(cursor.getTime() + remaining * 60_000);
      return { end, wait_minutes: +wait.toFixed(2) };
    }

    remaining -= availableMin;
    // Skok na začátek dalšího shiftu (přes večer / víkend)
    const beyondShift = new Date(todayShiftEnd.getTime() + 1);
    const nextStart = nextShiftStart(beyondShift, cfg);
    wait += (nextStart.getTime() - todayShiftEnd.getTime()) / 60_000;
    cursor = nextStart;
  }

  // Pojistka při bug v configu — nikdy by sem nemělo dojít
  return {
    end: new Date(cursor.getTime() + remaining * 60_000),
    wait_minutes: +wait.toFixed(2),
    overflow: true,
  };
}

module.exports = {
  getShiftConfig,
  parseTime,
  isoDow,
  isInShift,
  nextShiftStart,
  consumeShift,
  withTimeOfDay,
  addDays,
};
