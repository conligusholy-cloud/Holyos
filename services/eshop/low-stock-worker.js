// =============================================================================
// HolyOS — Spare Parts Shop low-stock e-mail worker
// Denní (default 06:00) check položek prodávaných v eshopu (sells_on_eshop=true)
// s current_stock pod min_stock. Pokud něco najde, pošle e-mail adminovi.
// =============================================================================
//
// Konfigurace (env):
//   ESHOP_LOWSTOCK_INTERVAL_MS    interval kontroly (default 24 h)
//   ESHOP_LOWSTOCK_HOUR           hodina denního běhu (default 6 = 06:00 lokálního času)
//   ESHOP_LOWSTOCK_THRESHOLD_PCT  prahová hodnota — alert i pro položky, které
//                                 jsou nad min_stock ale pod (min × pct/100)
//                                 (default 100 = jen pod min_stock)
//
// Recipient: stejný jako notifikace nové objednávky (EshopSettings.notification_email
// nebo env ESHOP_NOTIFICATION_EMAIL).
// =============================================================================

const { prisma } = require('../../config/database');
const { sendMail } = require('../email');

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 h
const DEFAULT_HOUR = 6;

let timer = null;
let _lastRunDate = null; // YYYY-MM-DD pro idempotenci

async function findLowStockItems(thresholdPct) {
  // Raw SQL — Prisma neumí column-vs-column srovnání v where
  const items = await prisma.$queryRaw`
    SELECT m.id, m.code, m.name, m.unit,
           m.current_stock::numeric as current_stock,
           m.min_stock::numeric as min_stock,
           m.reorder_quantity::numeric as reorder_quantity,
           m.supplier_id,
           c.name as supplier_name
    FROM materials m
    LEFT JOIN companies c ON c.id = m.supplier_id
    WHERE m.sells_on_eshop = TRUE
      AND m.status = 'active'
      AND m.min_stock IS NOT NULL
      AND m.current_stock < (m.min_stock * ${thresholdPct} / 100.0)
    ORDER BY (m.min_stock - m.current_stock) DESC
    LIMIT 100
  `;
  return items.map(m => ({
    id: m.id,
    code: m.code,
    name: m.name,
    unit: m.unit,
    current_stock: Number(m.current_stock),
    min_stock: Number(m.min_stock),
    reorder_quantity: m.reorder_quantity != null ? Number(m.reorder_quantity) : null,
    shortage: Number(m.min_stock) - Number(m.current_stock),
    supplier_id: m.supplier_id,
    supplier_name: m.supplier_name,
  }));
}

function buildEmailBody(items) {
  const lines = [
    `Denní přehled nízkých zásob — Spare Parts Shop`,
    ``,
    `Datum: ${new Date().toLocaleDateString('cs-CZ')}`,
    `Počet položek pod minimem: ${items.length}`,
    ``,
    `Top položky podle deficitu:`,
    ``,
  ];
  for (const it of items) {
    const reorder = it.reorder_quantity ? ` · doporučená objednávka: ${it.reorder_quantity} ${it.unit}` : '';
    const supplier = it.supplier_name ? ` · dodavatel: ${it.supplier_name}` : '';
    lines.push(`  ${it.code} — ${it.name}`);
    lines.push(`    skladem ${it.current_stock} ${it.unit} / min ${it.min_stock} · chybí ${it.shortage.toFixed(2)}${reorder}${supplier}`);
    lines.push(``);
  }
  lines.push(``);
  lines.push(`Detaily a hromadné akce: ${process.env.HOLYOS_BASE_URL || 'https://app.holyos.cz'}/modules/spare-parts/index.html`);
  return lines.join('\n');
}

async function runOnce(force = false) {
  try {
    const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    if (!force && _lastRunDate === todayKey) {
      return { skipped: 'already_ran_today' };
    }

    const settings = await prisma.eshopSettings.findUnique({ where: { id: 1 } });
    const recipientEmail = (settings && settings.notification_email)
      || process.env.ESHOP_NOTIFICATION_EMAIL
      || null;
    if (!recipientEmail) {
      console.log('[eshop-lowstock] notification_email není nakonfigurován — skipping');
      return { skipped: 'no-recipient' };
    }

    const thresholdPct = parseInt(process.env.ESHOP_LOWSTOCK_THRESHOLD_PCT, 10) || 100;
    const items = await findLowStockItems(thresholdPct);

    if (items.length === 0) {
      _lastRunDate = todayKey;
      console.log('[eshop-lowstock] vše OK, žádné nízké zásoby');
      return { sent: false, items: 0 };
    }

    const fromAddr = process.env.ESHOP_NOTIFICATION_FROM
      || process.env.GRAPH_DEFAULT_FROM
      || null;

    const subject = `[Spare Parts] ${items.length} položek pod minimem — ${new Date().toLocaleDateString('cs-CZ')}`;
    const body = buildEmailBody(items);
    const result = await sendMail({
      to: recipientEmail,
      from: fromAddr || undefined,
      subject,
      body,
    });

    _lastRunDate = todayKey;
    console.log(`[eshop-lowstock] e-mail s ${items.length} položkami odeslán na ${recipientEmail}:`, result.via || 'no-tx');
    return { sent: true, items: items.length, ...result };
  } catch (err) {
    console.error('[eshop-lowstock] selhalo:', err.message);
    return { sent: false, error: err.message };
  }
}

function start() {
  if (timer) { console.warn('[eshop-lowstock] worker už běží'); return; }
  const intervalMs = parseInt(process.env.ESHOP_LOWSTOCK_INTERVAL_MS, 10) || DEFAULT_INTERVAL_MS;
  const runHour = parseInt(process.env.ESHOP_LOWSTOCK_HOUR, 10) || DEFAULT_HOUR;
  console.log(`[eshop-lowstock] worker startuje, denní check v ${runHour}:00, fallback interval ${Math.round(intervalMs / 1000 / 60)} min`);

  // Tick check každých 30 minut — pokud aktuální hodina je runHour a ještě
  // se dnes neběželo, spustí runOnce. Idempotence v _lastRunDate.
  const TICK_MS = 30 * 60 * 1000;
  timer = setInterval(() => {
    const h = new Date().getHours();
    if (h === runHour) runOnce(false);
  }, TICK_MS);

  // Initial run za 2 minuty (po startu serveru), aby admin viděl alert hned
  // pokud něco je low (jen pokud aktuální hodina ≥ runHour, jinak počká na ráno)
  setTimeout(() => {
    if (new Date().getHours() >= runHour) runOnce(false);
  }, 2 * 60 * 1000);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; console.log('[eshop-lowstock] worker zastaven'); }
}

module.exports = { start, stop, runOnce, findLowStockItems };
