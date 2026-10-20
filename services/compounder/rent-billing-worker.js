// HolyOS — Měsíční podklady k fakturaci nájmu kiosků.
// V nastavený den v měsíci (issue_day) vytvoří pro aktivní KioskRentContract podklad za PŘEDCHOZÍ měsíc podle režimu smlouvy:
// draft = jen koncept · issue = vystavit (číslo NP-…) · send = vystavit a odeslat e-mailem kompetentní osobě.
// Chybí-li očekávaná faktura za nájem/energie, podklad se nevydá a zkusí se znovu při dalším běhu (každých 6 h).
'use strict';

const { prisma } = require('../../config/database');
const rent = require('./rent-statement');

const STARTUP_DELAY_MS = 60 * 1000;
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;
let _timer = null, _running = false;

async function runOnce() {
  if (_running) return; _running = true;
  try {
    const contracts = await prisma.kioskRentContract.findMany({ where: { active: true } });
    const parts = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' }).split('-').map(Number); // [rok, měsíc, den]
    const pm = parts[1] === 1 ? 12 : parts[1] - 1; const py = parts[1] === 1 ? parts[0] - 1 : parts[0];
    const ym = py + '-' + String(pm).padStart(2, '0');
    for (const c of contracts) {
      try {
        if (parts[2] < (c.issue_day || 5)) continue; // ještě není den vystavení
        const ex = await prisma.kioskRentStatement.findUnique({ where: { contract_id_period_ym: { contract_id: c.id, period_ym: ym } } });
        if (ex) {
          if (c.auto_mode === 'draft') continue; // koncept už existuje
          if (ex.status === 'issued') {
            if (c.auto_mode === 'send' && !ex.sent_at && c.contact_email) { const r = await rent.deliver(ex.id, c); console.log('[rent-billing] opakované odeslání ' + c.kiosk_code + ' ' + ym + ': ' + (r.sent ? 'OK' : r.error)); }
            continue;
          }
        }
        const r = await rent.processContract(c, ym);
        console.log('[rent-billing] ' + c.kiosk_code + ' ' + ym + ': ' + r.action + (r.missing ? ' (chybí: ' + r.missing.join(', ') + ')' : '') + (r.sent === false ? ' — e-mail selhal: ' + r.error : ''));
      } catch (e) {
        if (e && e.status === 400) continue; // smlouva v daném měsíci neběžela
        console.error('[rent-billing] ' + c.kiosk_code + ':', e.message);
      }
    }
  } catch (e) { console.error('[rent-billing] runOnce:', e.message); }
  finally { _running = false; }
}

function start() {
  if (_timer) return;
  setTimeout(function () { runOnce().catch(function () {}); }, STARTUP_DELAY_MS);
  _timer = setInterval(function () { runOnce().catch(function () {}); }, POLL_INTERVAL_MS);
  console.log('[rent-billing] worker spuštěn (poll 6 h)');
}
function stop() { if (_timer) { clearInterval(_timer); _timer = null; } }

module.exports = { start, stop, runOnce };
