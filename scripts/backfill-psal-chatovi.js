// HolyOS — jednorázový backfill stavu „Psal s chatem" (psal_chatovi)
// Nastaví stav psal_chatovi všem leadům, kteří už někdy napsali AI specialistovi,
// ale JEN z ranějších/mrtvých fází (aby to neshodilo pokročilé obchody — schůzka,
// smlouva, převeden…). Stejné pravidlo jako auto-přepnutí v chatu.
//
// Spuštění (proti Railway přes veřejné připojení):
//   DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/backfill-psal-chatovi.js
// Náhled bez zápisu:
//   DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/backfill-psal-chatovi.js --dry

const { prisma } = require('../config/database');

const CHAT_PROMOTE_FROM = ['new', 'nedovolano', 'volat_pristi', 'contacted', 'access_sent', 'odeslan_specialista', 'nezajem', 'nelze_pouzit', 'rejected'];
const DRY = process.argv.includes('--dry');

(async () => {
  try {
    // 1) Leady, které mají alespoň jednu zprávu zákazníka v chatu se specialistou.
    const rows = await prisma.aiSpecialistMessage.findMany({
      where: { role: 'user' },
      select: { lead_id: true },
      distinct: ['lead_id'],
    });
    const ids = Array.from(new Set(rows.map((r) => r.lead_id).filter(Boolean)));
    console.log('Leadů, kteří někdy chatovali:', ids.length);
    if (!ids.length) { await prisma.$disconnect(); return; }

    // 2) Kolik z nich je v přepnutelné fázi.
    const eligible = await prisma.compounderLead.findMany({
      where: { id: { in: ids }, status: { in: CHAT_PROMOTE_FROM } },
      select: { id: true, name: true, email: true, status: true },
    });
    console.log('Z toho v přepnutelné fázi:', eligible.length);
    eligible.forEach((l) => console.log('  #' + l.id, '·', l.status, '→ psal_chatovi', '·', l.name || l.email || ''));

    if (DRY) { console.log('\n[DRY RUN] Nic se nezapsalo. Spusť bez --dry pro aplikaci.'); await prisma.$disconnect(); return; }

    // 3) Přepnout.
    const upd = await prisma.compounderLead.updateMany({
      where: { id: { in: ids }, status: { in: CHAT_PROMOTE_FROM } },
      data: { status: 'psal_chatovi' },
    });
    console.log('\n✅ Přepnuto do „Psal s chatem":', upd.count);
    await prisma.$disconnect();
  } catch (e) {
    console.error('Chyba:', e.message);
    try { await prisma.$disconnect(); } catch (_) {}
    process.exit(1);
  }
})();
