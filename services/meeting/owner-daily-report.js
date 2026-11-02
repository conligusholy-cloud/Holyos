// =============================================================================
// HolyOS — Denní hlídání schůzek domluvených obchodníky
// =============================================================================
// Každý pracovní den po nastavené hodině (výchozí 18:00 Europe/Prague) pošle Janu a Tomášovi Holým
// push do Velína + zvonek: kolik schůzek který obchodník dnes domluvil, cíl a úspěšnost za 30 dní.
// Stav odeslání (datum) drží AppSetting 'meeting.owner_report_last' — report odejde max 1× denně.
// Hodina: AppSetting 'obchodnik.report_hour' (0–23).

'use strict';

const { prisma } = require('../../config/database');
const { getSetting, setSetting } = require('../settings');
const { notifyPerson } = require('../push/expo-push');
const { createNotification } = require('../../routes/notifications.routes');
const stats = require('./owner-stats');

const TICK_MS = 5 * 60 * 1000;
const LAST_KEY = 'meeting.owner_report_last';
let _t = null, _busy = false;

function pragueParts() {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { weekday: p.weekday, hour: parseInt(p.hour, 10) };
}

async function recipients() {
  const ids = [];
  for (const w of [{ f: 'Jan', l: 'Holý' }, { f: 'Tomáš', l: 'Holý' }]) {
    const p = await prisma.person.findFirst({ where: { active: true, first_name: { equals: w.f, mode: 'insensitive' }, last_name: { equals: w.l, mode: 'insensitive' } }, select: { id: true, user_id: true } }).catch(() => null);
    if (p) ids.push(p);
  }
  return ids;
}

// Sestaví text reportu pro dnešek. Vrací { title, body, belowTarget:[jména] }.
async function buildReport() {
  const s = await stats.compute(prisma, 30);
  const today = stats.dayKey(new Date());
  const target = s.target;
  const lines = []; const below = [];
  let total = 0;
  s.people.forEach((p) => {
    const c = p.per_day[today] || { booked: 0 }; total += c.booked;
    const short = target > 0 && c.booked < target;
    if (short) below.push(p.name);
    // jen obchodníci, kteří něco domluvili nebo mají cíl (jinak by report plnili neaktivní lidé)
    if (c.booked > 0 || target > 0) lines.push((short ? '⚠️ ' : '✅ ') + p.name + ' ' + c.booked + (target > 0 ? '/' + target : '') + (p.rate != null ? ' (úsp. 30d ' + p.rate + ' %)' : ''));
  });
  const title = '📊 Schůzky dnes: ' + total + (target > 0 ? ' · pod cílem: ' + below.length : '');
  const body = (lines.length ? lines.join('\n') : 'Dnes žádný obchodník nedomluvil schůzku.') + '\nCelkem 30 dní: ' + s.totals.booked + ' domluveno' + (s.rate != null ? ', úspěšnost ' + s.rate + ' %' : '');
  return { title, body, below, total };
}

async function sendReport() {
  const r = await buildReport();
  const link = '/modules/prodejni-objednavky/index.html?gs_tab=obchodnik-ui';
  for (const p of await recipients()) {
    notifyPerson(prisma, p.id, { title: r.title, body: r.body, data: { type: 'owner_meetings_report', link }, sound: 'default' }).catch((e) => console.warn('[owner-report] push', p.id, e.message));
    if (p.user_id) createNotification({ userId: p.user_id, type: 'system', title: r.title, body: r.body, link }).catch((e) => console.warn('[owner-report] zvonek', p.user_id, e.message));
  }
  console.log('[owner-report] odesláno:', r.title);
  return r;
}

async function tick() {
  if (_busy) return; _busy = true;
  try {
    const { weekday, hour } = pragueParts();
    if (weekday === 'Sat' || weekday === 'Sun') return;
    const h = Number(await getSetting('obchodnik.report_hour', { type: 'number', defaultValue: 18 }).catch(() => 18));
    if (hour < (isNaN(h) ? 18 : h)) return;
    const today = stats.dayKey(new Date());
    const last = await getSetting(LAST_KEY, { type: 'string', defaultValue: '' }).catch(() => '');
    if (last === today) return;
    await setSetting(LAST_KEY, today, { type: 'string', description: 'Datum posledního denního reportu schůzek obchodníků' }); // nejdřív zapsat → nikdy 2×
    await sendReport();
  } catch (e) { console.warn('[owner-report] tick:', e.message); }
  finally { _busy = false; }
}

function start() { if (_t) return; _t = setInterval(tick, TICK_MS); setTimeout(tick, 30000); }
function stop() { if (_t) clearInterval(_t); _t = null; }

module.exports = { start, stop, tick, sendReport, buildReport };
