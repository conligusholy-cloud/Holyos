// HolyOS — výpis přesných odeslaných zpráv leadu (funel SMS/e-mail), i když funel už neexistuje
// Použití:  node scripts/lead-sent-messages.js <id leadu | e-mail | telefon | část jména>
// Produkce: DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/lead-sent-messages.js miroslavchocholousek3891@gmail.com
const { prisma } = require('../config/database');

(async () => {
  const q = String(process.argv[2] || '').trim();
  if (!q) { console.log('Zadej id, e-mail, telefon nebo jméno leadu.'); process.exit(1); }
  const where = /^\d+$/.test(q) && q.length < 9
    ? { id: Number(q) }
    : { OR: [{ email: { contains: q, mode: 'insensitive' } }, { phone: { contains: q.replace(/\s+/g, '') } }, { name: { contains: q, mode: 'insensitive' } }] };
  const leads = await prisma.compounderLead.findMany({ where, select: { id: true, name: true, email: true, phone: true }, take: 10 });
  if (!leads.length) { console.log('Lead nenalezen.'); process.exit(0); }
  for (const L of leads) {
    console.log('\n==================================================');
    console.log('Lead #' + L.id + ' — ' + (L.name || '?') + ' · ' + (L.email || '—') + ' · ' + (L.phone || '—'));
    const ev = await prisma.compounderEvent.findMany({
      where: { event: { in: ['funnel_sms', 'funnel_email'] }, props: { path: ['lead_id'], equals: L.id } },
      orderBy: { created_at: 'asc' },
    });
    if (!ev.length) console.log('(žádná odeslaná zpráva z funelu)');
    ev.forEach((r) => {
      const p = r.props || {};
      console.log('\n--- ' + (r.event === 'funnel_sms' ? 'SMS' : 'E-MAIL') + ' · ' + r.created_at.toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' }) + ' · varianta: ' + (p.variant || '?'));
      console.log('Komu: ' + (p.to || '—') + (p.from ? '   Od: ' + p.from : ''));
      if (p.subject) console.log('Předmět: ' + p.subject);
      console.log('Odkaz: ' + (p.link || '—'));
      console.log('Text:\n' + (p.text || '(neuložen)'));
    });
    const logs = await prisma.smsLog.findMany({ where: { lead_id: L.id }, orderBy: { created_at: 'asc' } });
    if (logs.length) {
      console.log('\nSMS brána (SmsLog):');
      logs.forEach((s) => console.log('  ' + s.created_at.toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' }) + ' · stav: ' + (s.status || '—') + ' · doručeno: ' + (s.delivered ? 'ano' : 'ne') + (s.error ? ' · chyba: ' + s.error : '') + ' · id: ' + (s.message_id || '—')));
    }
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
