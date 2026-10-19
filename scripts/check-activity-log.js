// HolyOS — diagnostika logu aktivit leadů (jen čte, nic nezapisuje)
//   node scripts/check-activity-log.js            → souhrn
//   node scripts/check-activity-log.js 1234       → log konkrétního leadu
const { prisma } = require('../config/database');
(async () => {
  try {
    const id = parseInt(process.argv[2], 10);
    if (id) {
      const l = await prisma.compounderLead.findUnique({ where: { id }, select: { id: true, name: true, status: true, owner_person_id: true, activity_log: true, notes: true, updated_at: true } });
      if (!l) { console.log('Lead nenalezen'); process.exit(0); }
      console.log('#' + l.id, l.name, '· stav', l.status, '· obchodník', l.owner_person_id, '· upraveno', l.updated_at);
      console.log('--- activity_log (' + (l.activity_log || '').length + ' znaků, ' + (l.activity_log || '').split('\n').filter(Boolean).length + ' řádků) ---');
      console.log(l.activity_log || '(prázdné)');
      console.log('--- notes ---'); console.log(l.notes || '(prázdné)');
      process.exit(0);
    }
    const all = await prisma.compounderLead.findMany({ select: { id: true, activity_log: true } });
    let withLog = 0, onlyRestore = 0, manual = 0;
    all.forEach((l) => { const lines = String(l.activity_log || '').split('\n').filter(Boolean); if (!lines.length) return; withLog++; if (lines.every((x) => /↩ Stav vrácen/.test(x))) onlyRestore++; if (lines.some((x) => !/↩ Stav vrácen|AI hovor|Import|FB reklamy|Otevřel|Zavoláno|Délka hovoru/.test(x))) manual++; });
    console.log('Leadů celkem:', all.length);
    console.log('S nějakým záznamem aktivit:', withLog);
    console.log('Jen s řádkem „Stav vrácen“ (nic dalšího):', onlyRestore);
    console.log('S ručními záznamy (poznámky obchodníků apod.):', manual);
    // Záznamy z „📝 Zaznamenat aktivitu“ v aplikaci Obchodník mají tvar „• [dd.mm.rrrr hh:mm] text“
    const own = all.filter((l) => /(^|\n)• \[\d{2}\.\d{2}\.\d{4}/.test(l.activity_log || ''));
    const nOwn = own.reduce((a, l) => a + (String(l.activity_log).match(/(^|\n)• \[\d{2}\.\d{2}\.\d{4}/g) || []).length, 0);
    console.log('Leadů se záznamem „Zaznamenat aktivitu“ (• [datum] …):', own.length, '· záznamů celkem:', nOwn);
    own.slice(0, 15).forEach((l) => { const m = String(l.activity_log).split('\n').find((x) => /^• \[/.test(x)); console.log('  #' + l.id + '  ' + m.slice(0, 110)); });
    process.exit(0);
  } catch (e) { console.error('Chyba:', e.message); process.exit(1); }
})();
