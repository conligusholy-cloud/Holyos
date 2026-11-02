// HolyOS — jednorázová oprava PL leadů: e-mail / jméno uložené jen v poznámce („adres e-mail: …") se přenese do polí leada.
// Spuštění (proti prod DB viz paměť railway_public_db):  node scripts/fix-pl-leads.js          → jen výpis
//                                                         node scripts/fix-pl-leads.js --apply  → zapíše změny
const { prisma } = require('../config/database');

(async () => {
  const apply = process.argv.includes('--apply');
  const leads = await prisma.compounderLead.findMany({
    where: { lang: 'pl', OR: [{ email: null }, { email: '' }] },
    select: { id: true, name: true, email: true, phone: true, notes: true },
  });
  let n = 0;
  for (const l of leads) {
    const notes = String(l.notes || '');
    const em = /adres[\s_]*e-?mail:\s*([^\s,;]+@[^\s,;]+)/i.exec(notes);
    const nm = /imi[eę][\s_]*i[\s_]*nazwisko:\s*(.+)/i.exec(notes);
    const data = {};
    if (em) data.email = em[1].trim().toLowerCase();
    if (nm && (!l.name || l.name === l.phone)) data.name = nm[1].split('\n')[0].trim().slice(0, 255);
    if (!Object.keys(data).length) continue;
    n++;
    console.log('#' + l.id, l.phone, '→', JSON.stringify(data));
    if (apply) await prisma.compounderLead.update({ where: { id: l.id }, data });
  }
  console.log((apply ? 'Opraveno: ' : 'K opravě (spusť s --apply): ') + n + ' z ' + leads.length);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
