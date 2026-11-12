// =============================================================================
// HolyOS — české státní svátky a fond pracovní doby
// =============================================================================
// Vytaženo z services/meetings/autorelease.js, aby stejný kalendář používal
// i výpočet přesčasů v HR (Požadavek #144). Autorelease si odsud bere isHoliday.

// Velikonoční neděle (Gaussův algoritmus) — vrací UTC datum.
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31);
  const da = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, mo - 1, da));
}

// České státní svátky: pevné + Velký pátek (Velikonoce −2) a Velikonoční pondělí (+1).
// m = 1..12, d = 1..31
function isHoliday(y, m, d) {
  const fixed = ['1-1', '5-1', '5-8', '7-5', '7-6', '9-28', '10-28', '11-17', '12-24', '12-25', '12-26'];
  if (fixed.includes(m + '-' + d)) return true;
  const e = easter(y);
  const add = (n) => {
    const x = new Date(e.getTime() + n * 86400000);
    return (x.getUTCMonth() + 1) + '-' + x.getUTCDate();
  };
  return [add(-2), add(1)].includes(m + '-' + d);
}

// Je to pracovní den? (Po–Pá a není státní svátek)
function isWorkingDay(y, m, d) {
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !isHoliday(y, m, d);
}

// Počet pracovních dnů v měsíci. month = 1..12
function workingDaysInMonth(year, month) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= days; d++) if (isWorkingDay(year, month, d)) n++;
  return n;
}

// Počet pracovních dnů v celém roce.
function workingDaysInYear(year) {
  let n = 0;
  for (let m = 1; m <= 12; m++) n += workingDaysInMonth(year, m);
  return n;
}

module.exports = { easter, isHoliday, isWorkingDay, workingDaysInMonth, workingDaysInYear };
