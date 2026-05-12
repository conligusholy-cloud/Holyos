// =============================================================================
// HolyOS — Worker: denní kontrola objednávek, kterým je třeba vystavit doplatkovou fakturu
// =============================================================================
//
// Spouští se v app.js po bootu serveru. Pollne každých 6 hodin (poprvé hned po
// startu s krátkým delayem, aby DB stihla migrace). Pro každou způsobilou objednávku
// zavolá issueFinalInvoiceForOrder a zaloguje výsledek.

const {
  getOrdersEligibleForFinalInvoice,
  issueFinalInvoiceForOrder,
} = require('./final-invoice');

const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 h
const STARTUP_DELAY_MS = 30 * 1000;          // 30 s — počká až DB migrace doběhnou

let _timer = null;
let _running = false;

async function runOnce() {
  if (_running) {
    console.log('[final-invoice-worker] Předchozí run ještě běží, přeskakuji.');
    return;
  }
  _running = true;
  try {
    const eligible = await getOrdersEligibleForFinalInvoice();
    if (eligible.length === 0) {
      console.log('[final-invoice-worker] Žádné objednávky k vystavení doplatkové faktury.');
      return;
    }
    console.log(`[final-invoice-worker] ${eligible.length} objednávek ke zpracování:`,
      eligible.map(e => e.order_number).join(', '));
    for (const e of eligible) {
      try {
        const result = await issueFinalInvoiceForOrder(e.order_id);
        if (result.created) {
          console.log(`[final-invoice-worker] ✓ Vystavena ${result.invoice.invoice_number} pro objednávku ${e.order_number} (celkem ${result.invoice.total} ${result.invoice.currency})`);
        } else {
          console.log(`[final-invoice-worker] ⏭ ${e.order_number} přeskočena: ${result.reason}`);
        }
      } catch (err) {
        console.error(`[final-invoice-worker] ✗ Chyba u objednávky ${e.order_number}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[final-invoice-worker] Run selhalo:', err);
  } finally {
    _running = false;
  }
}

function start() {
  console.log(`[final-invoice-worker] Start, poll každých ${POLL_INTERVAL_MS / 3600000} h.`);
  setTimeout(() => {
    runOnce().catch(err => console.error('[final-invoice-worker] startup run failed:', err));
    _timer = setInterval(() => {
      runOnce().catch(err => console.error('[final-invoice-worker] periodic run failed:', err));
    }, POLL_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = { start, stop, runOnce };
