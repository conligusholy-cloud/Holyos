// HolyOS — automatické uvolňování termínů schůzek (MeetingSlot) na N pracovních dnů dopředu.
// Nastavení: AppSetting compounder.meeting_autorelease; stav (dny, které už byly vygenerované): compounder.meeting_autorelease_state.
// Každý pracovní den se generuje JEDNOU (smazaný/upravený termín se znovu nevytváří).
const { prisma } = require('../../config/database');
const { getSetting, setSetting } = require('../settings');

const KEY = 'compounder.meeting_autorelease';
const KEY_STATE = 'compounder.meeting_autorelease_state';
const TZ = 'Europe/Prague';
const DEFAULTS = { enabled: false, workdays: 3, from: '10:00', to: '18:00', step: 30, duration_min: 17, capacity: 2, mode: null, note: '' };

function clean(c) {
  c = Object.assign({}, DEFAULTS, c || {});
  const hm = (v, d) => (/^\d{1,2}:\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : d);
  return {
    enabled: !!c.enabled,
    workdays: Math.min(Math.max(parseInt(c.workdays, 10) || 3, 1), 30),
    from: hm(c.from, DEFAULTS.from), to: hm(c.to, DEFAULTS.to),
    step: Math.min(Math.max(parseInt(c.step, 10) || 30, 5), 240),
    duration_min: Math.min(Math.max(parseInt(c.duration_min, 10) || 17, 5), 480),
    capacity: Math.min(Math.max(parseInt(c.capacity, 10) || 2, 1), 50),
    mode: ['online', 'osobne'].includes(c.mode) ? c.mode : null,
    note: c.note ? String(c.note).slice(0, 200) : '',
  };
}
async function getConfig() { return clean(await getSetting(KEY, { type: 'json', defaultValue: null }).catch(() => null)); }
async function saveConfig(c) { const v = clean(c); await setSetting(KEY, v, { type: 'json', description: 'Automatické uvolňování termínů schůzek' }); return v; }

// Datum/čas v pražském čase → UTC Date (bez závislosti na TZ serveru)
function pragueToUtc(y, m, d, h, mi) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const part = (t) => { const o = {}; fmt.formatToParts(new Date(t)).forEach((p) => { o[p.type] = p.value; }); return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute); };
  let t = guess - (part(guess) - guess);
  t = t - (part(t) - guess); // druhý průchod kvůli přechodu letní/zimní čas
  return new Date(t);
}
function pragueToday() { const o = {}; new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).forEach((p) => { o[p.type] = p.value; }); return { y: +o.year, m: +o.month, d: +o.day }; }

// České státní svátky — sdílený kalendář (stejný používá výpočet přesčasů v HR)
const { isHoliday } = require('../cz-svatky');

const ymdKey = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');

// Vygeneruje termíny pro nejbližších N pracovních dnů (dnešek se počítá, pokud zbývají budoucí časy). Vrací { created, days }.
async function run(opts) {
  const cfg = await getConfig();
  if (!cfg.enabled && !(opts && opts.force)) return { ok: true, skipped: 'vypnuto', created: 0, days: [] };
  const st = (await getSetting(KEY_STATE, { type: 'json', defaultValue: null }).catch(() => null)) || {};
  const done = new Set(Array.isArray(st.days) ? st.days : []);
  const t = pragueToday(); const [fh, fm] = cfg.from.split(':').map(Number); const [th, tm] = cfg.to.split(':').map(Number);
  const startMin = fh * 60 + fm, endMin = th * 60 + tm;
  const now = Date.now(); let created = 0; const daysDone = []; let counted = 0;
  const cur = new Date(Date.UTC(t.y, t.m - 1, t.d));
  for (let guard = 0; guard < 120 && counted < cfg.workdays; guard++, cur.setUTCDate(cur.getUTCDate() + 1)) {
    const y = cur.getUTCFullYear(), m = cur.getUTCMonth() + 1, d = cur.getUTCDate(), dow = cur.getUTCDay();
    if (dow === 0 || dow === 6 || isHoliday(y, m, d)) continue;
    counted++;
    const key = ymdKey(y, m, d);
    if (done.has(key)) continue;
    const rows = [];
    for (let mn = startMin; mn + cfg.step <= endMin; mn += cfg.step) {
      const s = pragueToUtc(y, m, d, Math.floor(mn / 60), mn % 60);
      if (s.getTime() <= now) continue;
      rows.push({ starts_at: s, duration_min: cfg.duration_min, capacity: cfg.capacity, mode: cfg.mode, note: cfg.note || null, active: true });
    }
    if (!rows.length && key === ymdKey(t.y, t.m, t.d)) counted--; // dnešek bez budoucích časů se do počtu dní nepočítá
    if (rows.length) {
      // pojistka proti duplicitě: už existující termín ve stejný čas se nezakládá znovu
      const ex = await prisma.meetingSlot.findMany({ where: { starts_at: { in: rows.map((r) => r.starts_at) } }, select: { starts_at: true } });
      const have = new Set(ex.map((e) => e.starts_at.getTime()));
      const add = rows.filter((r) => !have.has(r.starts_at.getTime()));
      if (add.length) { const r = await prisma.meetingSlot.createMany({ data: add }); created += r.count; }
    }
    done.add(key); daysDone.push(key);
  }
  // úklid stavu: jen dny od dneška dál
  const todayKey = ymdKey(t.y, t.m, t.d);
  await setSetting(KEY_STATE, { days: [...done].filter((k) => k >= todayKey).sort(), last_run: new Date().toISOString(), last_created: created }, { type: 'json' }).catch(() => {});
  if (created) console.log('[meeting-autorelease] vytvořeno ' + created + ' termínů pro ' + daysDone.join(', '));
  return { ok: true, created, days: daysDone };
}
async function status() { const st = (await getSetting(KEY_STATE, { type: 'json', defaultValue: null }).catch(() => null)) || {}; return { last_run: st.last_run || null, last_created: st.last_created || 0, days: st.days || [] }; }

let _timer = null;
function start() {
  if (_timer) return;
  const tick = () => run().catch((e) => console.warn('[meeting-autorelease]', e.message));
  setTimeout(tick, 45000).unref();
  _timer = setInterval(tick, 30 * 60000); _timer.unref();
}

module.exports = { getConfig, saveConfig, run, status, start, DEFAULTS };
