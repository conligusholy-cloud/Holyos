// HolyOS — Období zdanění z popisu položky přijaté faktury (např. „01/09/2026 - 30/09/2026")
// Slouží k jistému určení, že náklad (energie apod.) patří do vyúčtovávaného měsíce.
function parsePeriod(desc) {
  const m = String(desc || '').match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})\s*[-–—]\s*(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  if (!m) return null;
  const a = Date.UTC(+m[3], +m[2] - 1, +m[1]), b = Date.UTC(+m[6], +m[5] - 1, +m[4]);
  if (!(b >= a)) return null;
  return { from: a, to: b };
}
// 'yes' = období na dokladu odpovídá měsíci (aspoň 80 % období leží v měsíci), 'no' = jiné období, 'unknown' = období v popisu není
function periodVsMonth(desc, ym) {
  const p = parsePeriod(desc); if (!p) return 'unknown';
  const [y, mo] = String(ym).split('-').map(Number);
  const ms = Date.UTC(y, mo - 1, 1), me = Date.UTC(y, mo, 0);
  const overlap = Math.max(0, Math.min(p.to, me) - Math.max(p.from, ms)) / 86400000 + (Math.min(p.to, me) >= Math.max(p.from, ms) ? 1 : 0);
  const len = (p.to - p.from) / 86400000 + 1;
  return overlap / len >= 0.8 ? 'yes' : 'no';
}
module.exports = { parsePeriod, periodVsMonth };
