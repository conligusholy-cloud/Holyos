// HolyOS — vrácení CRM stavů leadů, které přepsal automat Centra reklamy
// Automat nastavoval status = odeslan_specialista / odeslana_schuzka (po odeslání SMS/e-mailu)
// a nelze_pouzit (po bounce/odhlášení). Od teď to řeší samostatné pole marketing_status.
//
// Pravidla (konzervativní — nesahá na to, co mohli kolegové změnit ručně):
//  • bere jen leady, které MAJÍ doložené odeslání automatem a stále mají přesně ten automatický stav
//  • vynechá lead, na který obchodník po odeslání volal (last_called_at > odeslání)
//  • původní stav = 'new' (automat běžel jen na nové); kdo psal s AI specialistou → 'psal_chatovi'
//  • nelze_pouzit vrací jen u adres zapsaných automatem na black list (poznámka „auto: …")
//  • zapíše řádek do activity_log a doplní marketing_status
//
// Náhled (nic nezapisuje):
//   DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/restore-lead-statuses-after-ads-center.js
// Ostrý běh:
//   DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/restore-lead-statuses-after-ads-center.js --apply
// Volitelně --since=2026-10-13 (jen leady odeslané od tohoto data; výchozí = bez omezení)

const { prisma } = require('../config/database');

const APPLY = process.argv.includes('--apply');
const sinceArg = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8);
const SINCE = sinceArg ? new Date(sinceArg) : null;

function lastSent(l) {
  const ds = [l.ai_specialist_email_sent_at, l.ai_specialist_sms_sent_at, l.schuzka_email_sent_at, l.schuzka_sms_sent_at].filter(Boolean).map((d) => +new Date(d));
  return ds.length ? new Date(Math.max.apply(null, ds)) : null;
}

(async () => {
  try {
    const leads = await prisma.compounderLead.findMany({
      where: { status: { in: ['odeslan_specialista', 'odeslana_schuzka', 'nelze_pouzit'] } },
      select: { id: true, name: true, email: true, status: true, last_called_at: true, activity_log: true, outreach_variant: true, ai_specialist_sms_channel: true,
        ai_specialist_email_sent_at: true, ai_specialist_sms_sent_at: true, schuzka_email_sent_at: true, schuzka_sms_sent_at: true },
    });
    const chatted = new Set((await prisma.aiSpecialistMessage.findMany({ where: { role: 'user', lead_id: { in: leads.map((l) => l.id) } }, select: { lead_id: true }, distinct: ['lead_id'] })).map((r) => r.lead_id));
    const blocks = await prisma.compounderBlocklist.findMany({ where: { note: { startsWith: 'auto:' } }, select: { email: true } });
    const autoBlocked = new Set(blocks.map((b) => String(b.email || '').toLowerCase()).filter(Boolean));

    const plan = []; const skipped = [];
    for (const l of leads) {
      const sent = lastSent(l);
      if (l.status === 'nelze_pouzit') {
        if (!l.email || !autoBlocked.has(String(l.email).toLowerCase())) { skipped.push([l, 'nelze_pouzit není z automatu']); continue; }
        plan.push({ l, to: chatted.has(l.id) ? 'psal_chatovi' : 'new', mkt: 'blokovan' });
        continue;
      }
      if (!sent) { skipped.push([l, 'bez doloženého odeslání']); continue; }
      if (l.ai_specialist_sms_channel === 'phone' && l.status === 'odeslan_specialista' && !l.ai_specialist_email_sent_at) { skipped.push([l, 'SMS z telefonu = ruční akce obchodníka']); continue; }
      if (SINCE && sent < SINCE) { skipped.push([l, 'odesláno před --since']); continue; }
      if (l.last_called_at && new Date(l.last_called_at) > sent) { skipped.push([l, 'obchodník po odeslání volal']); continue; }
      plan.push({ l, to: chatted.has(l.id) ? 'psal_chatovi' : 'new', mkt: l.status === 'odeslana_schuzka' ? 'osloven_schuzka' : 'osloven_specialista' });
    }

    const sum = {}; plan.forEach((p) => { const k = p.l.status + ' → ' + p.to; sum[k] = (sum[k] || 0) + 1; });
    console.log('K obnovení:', plan.length, JSON.stringify(sum, null, 1));
    console.log('Přeskočeno:', skipped.length);
    skipped.slice(0, 30).forEach(([l, why]) => console.log('  #' + l.id, l.status, '—', why));
    plan.slice(0, 40).forEach((p) => console.log('  #' + p.l.id, p.l.status, '→', p.to, '·', p.l.name || p.l.email || ''));
    if (plan.length > 40) console.log('  … a dalších', plan.length - 40);

    if (!APPLY) { console.log('\n[NÁHLED] Nic se nezapsalo. Pro zápis přidej --apply.'); await prisma.$disconnect(); return; }

    const stamp = new Date().toLocaleString('cs-CZ');
    let n = 0;
    for (const p of plan) {
      const line = '[' + stamp + '] ↩ Stav vrácen z „' + p.l.status + '" na „' + p.to + '" (oprava po zavedení marketingových stavů)';
      await prisma.compounderLead.update({ where: { id: p.l.id }, data: { status: p.to, marketing_status: p.mkt, activity_log: line + (p.l.activity_log ? '\n' + p.l.activity_log : '') } });
      n++;
    }
    console.log('\n✅ Obnoveno:', n);
    await prisma.$disconnect();
  } catch (e) {
    console.error('Chyba:', e.message);
    try { await prisma.$disconnect(); } catch (_) {}
    process.exit(1);
  }
})();
