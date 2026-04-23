// HolyOS — Print orchestrator
//
// Hlavní businessová vrstva nad ZPL rendererem a TSC driverem.
// Stará se o:
//   1) autoselekci tiskárny (podle printer_id → location_id → priority)
//   2) vyplnění šablony daty
//   3) zápis záznamu do print_jobs (audit)
//   4) odeslání na tiskárnu přes TCP
//   5) aktualizaci stavu print_jobs + last_ping_ok na tiskárně

const { prisma } = require('../../config/database');
const { render } = require('./zpl-renderer');
const { sendZpl, ping } = require('./tsc-driver');

/**
 * Vybere tiskárnu podle pořadí priorit:
 *   1. explicitní printer_id
 *   2. tiskárna přiřazená k location_id (podle Printer.location_id)
 *   3. nejvyšší priority z aktivních
 */
async function selectPrinter({ printer_id, location_id }) {
  if (printer_id) {
    const p = await prisma.printer.findUnique({ where: { id: printer_id } });
    if (!p) throw new Error(`Tiskárna ${printer_id} neexistuje`);
    if (!p.is_active) throw new Error(`Tiskárna "${p.name}" je neaktivní`);
    return p;
  }
  if (location_id) {
    const p = await prisma.printer.findFirst({
      where: { location_id, is_active: true },
      orderBy: { priority: 'desc' },
    });
    if (p) return p;
    // fallthrough — žádná přiřazená tiskárna
  }
  const p = await prisma.printer.findFirst({
    where: { is_active: true },
    orderBy: { priority: 'desc' },
  });
  if (!p) throw new Error('Žádná aktivní tiskárna není k dispozici');
  return p;
}

/**
 * Vytiskne jednu etiketu (popř. více kopií).
 *
 * @param {object} opts
 * @param {string} opts.template    - kód šablony (label_templates.code), např. 'item_label'
 * @param {object} opts.data        - hodnoty pro placeholdery
 * @param {number} [opts.printer_id]
 * @param {number} [opts.location_id] - pro autoselekci
 * @param {number} [opts.copies=1]
 * @param {number} [opts.user_id]
 * @param {string} [opts.device_id]
 * @returns {Promise<object>} záznam print_jobs
 */
async function printLabel({ template, data, printer_id, location_id, copies = 1, user_id, device_id }) {
  // 1. Šablona
  const tpl = await prisma.labelTemplate.findUnique({ where: { code: template } });
  if (!tpl) throw new Error(`Šablona "${template}" neexistuje`);
  if (!tpl.is_active) throw new Error(`Šablona "${template}" je neaktivní`);

  // 2. Tiskárna
  const printer = await selectPrinter({ printer_id, location_id });

  // 3. Render
  const zplSingle = render(tpl.body, data || {});
  // Pro kopie opakujeme sekvenci ^XA...^XZ; TSC TC200 tiskne každou zvlášť.
  const zpl = Array.from({ length: Math.max(1, copies) }, () => zplSingle).join('\n');

  // 4. Zápis do print_jobs — status 'queued'
  const job = await prisma.printJob.create({
    data: {
      template_id: tpl.id,
      printer_id: printer.id,
      data: data || {},
      copies,
      status: 'queued',
      requested_by: user_id || null,
      device_id: device_id || null,
    },
  });

  // 5. Odeslání na tiskárnu
  if (!printer.ip_address) {
    await prisma.printJob.update({
      where: { id: job.id },
      data: { status: 'failed', error: 'Tiskárna nemá nastavenou IP adresu', finished_at: new Date() },
    });
    throw new Error(`Tiskárna "${printer.name}" nemá IP`);
  }

  const result = await sendZpl({
    ip: printer.ip_address,
    port: printer.port || 9100,
    zpl,
  });

  // 6. Update statusu joba + last_ping_ok
  const updated = await prisma.printJob.update({
    where: { id: job.id },
    data: {
      status: result.ok ? 'done' : 'failed',
      error: result.ok ? null : result.error,
      finished_at: new Date(),
    },
  });

  if (result.ok) {
    await prisma.printer.update({
      where: { id: printer.id },
      data: { last_ping_ok: new Date() },
    });
  }

  if (!result.ok) {
    console.error(`[Print] Tiskárna "${printer.name}" selhala: ${result.error}`);
    const e = new Error(`Tisk selhal: ${result.error}`);
    e.jobId = updated.id;
    e.printerId = printer.id;
    throw e;
  }

  console.log(`[Print] Job #${updated.id} OK — tiskárna "${printer.name}", ${result.bytes} B, ${result.latencyMs} ms`);
  return updated;
}

/**
 * Ping tiskárny + volitelně testovací etiketa.
 */
async function testPrinter(printer_id, { withTestLabel = true } = {}) {
  const printer = await prisma.printer.findUnique({ where: { id: printer_id } });
  if (!printer) throw new Error(`Tiskárna ${printer_id} neexistuje`);
  if (!printer.ip_address) {
    return { ping_ok: false, print_ok: false, error: 'Nenastavená IP adresa' };
  }

  const pingRes = await ping({ ip: printer.ip_address, port: printer.port || 9100 });
  if (pingRes.ok) {
    await prisma.printer.update({ where: { id: printer.id }, data: { last_ping_ok: new Date() } });
  }

  if (!withTestLabel || !pingRes.ok) {
    return {
      ping_ok: pingRes.ok,
      print_ok: false,
      latency_ms: pingRes.latencyMs,
      error: pingRes.error || null,
    };
  }

  // Testovací etiketa — minimální ZPL s identifikací tiskárny
  const testZpl = [
    '^XA',
    '^FO20,20^ADN,24,12^FDHolyOS TEST^FS',
    `^FO20,60^ADN,14,8^FD${printer.name}^FS`,
    `^FO20,90^ADN,14,8^FD${new Date().toLocaleString('cs-CZ')}^FS`,
    '^XZ',
  ].join('\n');

  const sendRes = await sendZpl({ ip: printer.ip_address, port: printer.port || 9100, zpl: testZpl });
  return {
    ping_ok: pingRes.ok,
    print_ok: sendRes.ok,
    latency_ms: pingRes.latencyMs + sendRes.latencyMs,
    error: sendRes.error || null,
  };
}

module.exports = { printLabel, testPrinter, selectPrinter };
