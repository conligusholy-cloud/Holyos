// =============================================================================
// HolyOS — Infolinka: která směna z rozpisu právě platí
// =============================================================================
// Rozpis směn je uložený jako { "YYYY-MM-DD": { wperson, main, backup } }
// (AppSetting voice.infolinka.shifts). Tenhle modul z aktuálního času odvodí,
// KTERÝ ŘÁDEK rozpisu platí a KTERÉ ROLE se mají vytáčet.
//
// Pravidla (vše v Europe/Prague):
//   Po–Čt  7:00–15:00   → řádek toho dne,      V práci → Hlavní → Záložní
//   Po–Čt 15:00–7:00    → řádek toho dne,      Hlavní → Záložní   (noc přesahuje do dalšího dne)
//   Pá     7:00–15:00   → řádek pátku,         V práci → Hlavní → Záložní
//   Pá    15:00–So 0:00 → řádek pátku,         Hlavní → Záložní
//   So     0:00–Ne 7:00 → řádek soboty,        Hlavní → Záložní
//   Ne     7:00–Po 7:00 → řádek neděle,        Hlavní → Záložní
//
// POZOR na noční přesahy: v úterý ve 2:00 platí PONDĚLNÍ řádek, v neděli
// v 5:00 platí SOBOTNÍ a v pondělí v 5:00 NEDĚLNÍ. Proto se nestačí podívat
// na dnešní datum — viz rosterDate níže.
//
// Časy schválně NEčteme ze serverového času (Railway běží v UTC) — den i hodinu
// bereme přes Intl v pražském pásmu, takže sedí i přes přechod na letní čas.

const TZ = 'Europe/Prague';

const DAY_START_HOUR = 7;      // začátek denní služby (Po–Pá) i nedělní služby
const WORK_END_HOUR = 15;      // konec pásma s osobou „v práci"

const ROLES_DAY = ['wperson', 'main', 'backup'];
const ROLES_NIGHT = ['main', 'backup'];

// Rozloží okamžik na kalendářní složky v Europe/Prague.
function pragueParts(date) {
  const d = date instanceof Date ? date : new Date(date);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    weekday: 'short',
  });
  const parts = {};
  for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
  // weekday 'Mon'…'Sun' → ISO 1..7
  const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    ymd: parts.year + '-' + parts.month + '-' + parts.day,
    hour: parseInt(parts.hour, 10) % 24, // '24' o půlnoci u některých runtime
    minute: parseInt(parts.minute, 10),
    dow: map[parts.weekday] || 1,
  };
}

// Posun data (YYYY-MM-DD) o N dní — počítáno v UTC poledne, aby přechod
// na letní čas neposunul datum o den.
function shiftYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d, 12, 0, 0) + days * 86400000;
  const x = new Date(t);
  return x.getUTCFullYear() + '-' + String(x.getUTCMonth() + 1).padStart(2, '0') + '-' + String(x.getUTCDate()).padStart(2, '0');
}

/**
 * resolveShiftWindow — který řádek rozpisu a které role platí pro daný okamžik.
 *
 * @param {Date|string|number} [now] - okamžik (default: teď)
 * @returns {{ rosterDate: string, roles: string[], mode: string, label: string, dow: number }}
 *   rosterDate — klíč do rozpisu ("YYYY-MM-DD")
 *   roles      — pořadí rolí k vytáčení
 *   mode       — 'weekday_day' | 'weekday_night' | 'saturday' | 'sunday'
 *   label      — lidsky čitelné pásmo (do logu a do UI)
 */
function resolveShiftWindow(now) {
  const p = pragueParts(now || new Date());
  const beforeMorning = p.hour < DAY_START_HOUR;          // 0:00–6:59
  const inWorkBand = p.hour >= DAY_START_HOUR && p.hour < WORK_END_HOUR;

  // Pondělí 0:00–7:00 → ještě nedělní služba
  if (p.dow === 1 && beforeMorning) {
    return { rosterDate: shiftYmd(p.ymd, -1), roles: ROLES_NIGHT, mode: 'sunday', label: 'Ne 7:00 – Po 7:00', dow: p.dow };
  }
  // Neděle 0:00–7:00 → ještě sobotní služba
  if (p.dow === 7 && beforeMorning) {
    return { rosterDate: shiftYmd(p.ymd, -1), roles: ROLES_NIGHT, mode: 'saturday', label: 'So 0:00 – Ne 7:00', dow: p.dow };
  }
  // Neděle od 7:00 → nedělní služba (běží do pondělí 7:00)
  if (p.dow === 7) {
    return { rosterDate: p.ymd, roles: ROLES_NIGHT, mode: 'sunday', label: 'Ne 7:00 – Po 7:00', dow: p.dow };
  }
  // Sobota celý den → sobotní služba (běží do neděle 7:00)
  if (p.dow === 6) {
    return { rosterDate: p.ymd, roles: ROLES_NIGHT, mode: 'saturday', label: 'So 0:00 – Ne 7:00', dow: p.dow };
  }
  // Út–Pá 0:00–7:00 → noční část PŘEDCHOZÍHO pracovního dne
  if (beforeMorning) {
    return { rosterDate: shiftYmd(p.ymd, -1), roles: ROLES_NIGHT, mode: 'weekday_night', label: '15:00 – 7:00', dow: p.dow };
  }
  // Po–Pá 7:00–15:00 → denní pásmo s osobou „v práci"
  if (inWorkBand) {
    return { rosterDate: p.ymd, roles: ROLES_DAY, mode: 'weekday_day', label: '7:00 – 15:00', dow: p.dow };
  }
  // Po–Čt 15:00–24:00 → noční pásmo téhož dne; pátek 15:00–24:00 končí sobotní půlnocí
  return {
    rosterDate: p.ymd,
    roles: ROLES_NIGHT,
    mode: 'weekday_night',
    label: p.dow === 5 ? 'Pá 15:00 – So 0:00' : '15:00 – 7:00',
    dow: p.dow,
  };
}

// Popis platnosti směny pro daný kalendářní den — do tabulky rozpisu.
// dow: ISO 1..7
function windowLabelForDay(dow) {
  if (dow === 6) return 'So 0:00 – Ne 7:00';
  if (dow === 7) return 'Ne 7:00 – Po 7:00';
  if (dow === 5) return '7:00–15:00 · 15:00 – So 0:00';
  return '7:00–15:00 · 15:00–7:00';
}

// Používá se role „V práci" v daném dni? (o víkendu ne)
function usesWorkPerson(dow) {
  return dow >= 1 && dow <= 5;
}

module.exports = {
  resolveShiftWindow,
  windowLabelForDay,
  usesWorkPerson,
  pragueParts,
  shiftYmd,
  TZ,
  DAY_START_HOUR,
  WORK_END_HOUR,
  ROLES_DAY,
  ROLES_NIGHT,
};
