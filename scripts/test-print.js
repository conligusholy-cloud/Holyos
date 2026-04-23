// HolyOS — Test tiskového subsystému
//
// Proběhne 3 fáze:
//   1. Unit test ZPL rendereru (bez sítě, bez DB)
//   2. Ping všech tiskáren z DB (TCP connect + close)
//   3. Zkušební tisk (pošle "HolyOS TEST" etiketu) — jen pokud --print
//
// Spuštění:
//   node scripts/test-print.js                    # jen render + ping
//   node scripts/test-print.js --print            # + pošle testovací etiketu
//   node scripts/test-print.js --print --id 1     # jen tiskárnu s id=1

const { PrismaClient } = require('@prisma/client');
const { render, extractPlaceholders } = require('../services/print/zpl-renderer');
const { ping, sendZpl } = require('../services/print/tsc-driver');

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const DO_PRINT = args.includes('--print');
const idArg = args.indexOf('--id');
const ONLY_ID = idArg !== -1 ? Number(args[idArg + 1]) : null;

function section(title) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}

async function main() {
  // ---------------------------------------------------------------
  // 1. Unit test ZPL rendereru
  // ---------------------------------------------------------------
  section('[1/3] ZPL renderer — unit test');

  const template = '^XA\n^FO20,20^BQN,2,3^FDMA,{{barcode}}^FS\n^FO160,25^ADN,18,10^FD{{name}}^FS\n^XZ';
  const data = { barcode: 'BS-001-ABC', name: 'Matice M8 ČSN 021401' };
  const placeholders = extractPlaceholders(template);
  const rendered = render(template, data);

  console.log('Vstupní šablona:');
  console.log('  ' + template.replace(/\n/g, '\n  '));
  console.log('\nData:');
  console.log('  ' + JSON.stringify(data));
  console.log('\nDetekované placeholdery:', placeholders);
  console.log('\nVýstup renderu:');
  console.log('  ' + rendered.replace(/\n/g, '\n  '));

  // Ověř, že placeholdery byly nahrazené
  const ok = !rendered.includes('{{') && !rendered.includes('}}');
  console.log(`\nRender ${ok ? 'OK' : 'CHYBA — zůstaly placeholdery v výstupu!'}`);

  // ---------------------------------------------------------------
  // 2. Ping tiskáren
  // ---------------------------------------------------------------
  section('[2/3] Ping tiskáren (TCP connect + close)');

  const where = ONLY_ID ? { id: ONLY_ID } : { is_active: true };
  const printers = await prisma.printer.findMany({ where, orderBy: { priority: 'desc' } });
  if (printers.length === 0) {
    console.log('Žádná tiskárna v DB.');
    return;
  }

  for (const p of printers) {
    if (!p.ip_address) {
      console.log(`  ${p.name.padEnd(24)} SKIP — nenastavená IP`);
      continue;
    }
    const r = await ping({ ip: p.ip_address, port: p.port || 9100, timeoutMs: 3000 });
    const status = r.ok ? `OK (${r.latencyMs} ms)` : `FAIL: ${r.error}`;
    console.log(`  ${p.name.padEnd(24)} ${p.ip_address}:${p.port}  → ${status}`);
    if (r.ok) {
      await prisma.printer.update({
        where: { id: p.id },
        data: { last_ping_ok: new Date() },
      });
    }
  }

  if (!DO_PRINT) {
    console.log('\nPro zkušební tisk spusť: node scripts/test-print.js --print');
    return;
  }

  // ---------------------------------------------------------------
  // 3. Zkušební tisk
  // ---------------------------------------------------------------
  section('[3/3] Zkušební tisk');

  const testZpl = [
    '^XA',
    '^FO20,20^ADN,24,12^FDHolyOS TEST^FS',
    '^FO20,60^ADN,14,8^FD{{name}}^FS',
    `^FO20,90^ADN,14,8^FD${new Date().toLocaleString('cs-CZ')}^FS`,
    '^XZ',
  ].join('\n');

  for (const p of printers) {
    if (!p.ip_address) continue;
    const zpl = render(testZpl, { name: p.name });
    console.log(`\n→ ${p.name} (${p.ip_address}:${p.port})`);
    const r = await sendZpl({ ip: p.ip_address, port: p.port || 9100, zpl });
    if (r.ok) {
      console.log(`  OK — ${r.bytes} B, ${r.latencyMs} ms. Zkontroluj fyzický výstup!`);
    } else {
      console.log(`  FAIL: ${r.error}`);
    }
  }
}

main()
  .catch(e => { console.error('\nCHYBA:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
