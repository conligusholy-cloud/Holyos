// HolyOS — statistika SMS „schůzka — cesta k rozhodnutí"
// Použití:  node scripts/schuzka-sms-stats.js [--since=2026-10-01]
// Produkce: DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/schuzka-sms-stats.js
const { prisma } = require('../config/database');

(async () => {
  const arg = (process.argv.find((a) => a.startsWith('--since=')) || '').split('=')[1];
  const since = arg ? new Date(arg + 'T00:00:00') : null;
  const day = (d) => d.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' });

  // 1) Leady s odeslanou SMS schůzky (zdroj pravdy: čas odeslání u leadu)
  const leads = await prisma.compounderLead.findMany({
    where: { schuzka_sms_sent_at: since ? { gte: since } : { not: null } },
    select: { id: true, name: true, owner_person_id: true, schuzka_sms_sent_at: true, schuzka_sms_status: true, schuzka_email_sent_at: true },
    orderBy: { schuzka_sms_sent_at: 'asc' },
  });
  const owners = await prisma.person.findMany({ where: { id: { in: Array.from(new Set(leads.map((l) => l.owner_person_id).filter(Boolean))) } }, select: { id: true, first_name: true, last_name: true } });
  const on = {}; owners.forEach((p) => { on[p.id] = (p.first_name || '') + ' ' + (p.last_name || ''); });

  console.log('\nSMS „schůzka" — odesláno leadům: ' + leads.length + (since ? ' (od ' + day(since) + ')' : ' (celkem)'));
  if (leads.length) console.log('První: ' + day(leads[0].schuzka_sms_sent_at) + ' · poslední: ' + day(leads[leads.length - 1].schuzka_sms_sent_at));

  const byDay = {}, byOwner = {};
  leads.forEach((l) => { const k = day(l.schuzka_sms_sent_at); byDay[k] = (byDay[k] || 0) + 1; const o = on[l.owner_person_id] || '(bez obchodníka)'; byOwner[o] = (byOwner[o] || 0) + 1; });
  console.log('\nPo dnech:'); Object.keys(byDay).forEach((k) => console.log('  ' + k + ': ' + byDay[k]));
  console.log('\nPo obchodnících:'); Object.keys(byOwner).forEach((k) => console.log('  ' + k + ': ' + byOwner[k]));
  console.log('\nS e-mailem navíc: ' + leads.filter((l) => l.schuzka_email_sent_at).length);

  // 2) Doručení z SMS brány (SmsLog, kontext schuzka)
  const logs = await prisma.smsLog.findMany({ where: { context: 'schuzka', ...(since ? { created_at: { gte: since } } : {}) }, select: { status: true, delivered: true, error: true } });
  const st = {}; logs.forEach((s) => { const k = s.delivered ? 'doručeno' : (s.status || 'unknown'); st[k] = (st[k] || 0) + 1; });
  console.log('\nSMS brána (SmsLog, kontext schuzka): ' + logs.length + ' zpráv');
  Object.keys(st).forEach((k) => console.log('  ' + k + ': ' + st[k]));

  // 3) Kliknutí na odkaz z SMS (příchod na landing z kanálu sms u těchto leadů)
  const ids = leads.map((l) => l.id);
  if (ids.length) {
    const ev = await prisma.compounderEvent.findMany({ where: { event: 'funnel_landing', sid: { in: ids.map((i) => 'lead:' + i) } }, select: { sid: true, props: true } });
    const clicked = new Set(ev.filter((e) => !e.props || !e.props.channel || e.props.channel === 'sms').map((e) => e.sid));
    console.log('\nKliklo na odkaz: ' + clicked.size + ' z ' + leads.length + ' (' + Math.round((clicked.size / leads.length) * 100) + ' %)');
  }
  // 4) Domluvené schůzky (MeetingReservation) — celkem a z leadů, kterým šla SMS schůzky
  const resAll = await prisma.meetingReservation.findMany({
    where: since ? { created_at: { gte: since } } : {},
    select: { compounder_lead_id: true, status: true, mode: true, financing_path: true, created_at: true, slot: { select: { starts_at: true } } },
  });
  const act = resAll.filter((r) => r.status !== 'canceled');
  console.log('\nDomluvené schůzky (všechny zdroje): ' + act.length + ' aktivních (zrušeno ' + (resAll.length - act.length) + ', celkem rezervací ' + resAll.length + ')');
  const cnt = (arr, f) => { const o = {}; arr.forEach((r) => { const k = f(r) || '—'; o[k] = (o[k] || 0) + 1; }); return o; };
  const stC = cnt(resAll, (r) => r.status); console.log('  podle stavu: ' + JSON.stringify(stC));
  const pathC = cnt(act, (r) => r.financing_path); console.log('  podle cesty: ' + JSON.stringify(pathC));
  const idset = new Set(ids);
  const fromSms = act.filter((r) => r.compounder_lead_id && idset.has(r.compounder_lead_id));
  const uniq = new Set(fromSms.map((r) => r.compounder_lead_id));
  console.log('\nZ leadů se SMS schůzky: ' + uniq.size + ' domluvilo schůzku' + (leads.length ? ' z ' + leads.length + ' (' + Math.round((uniq.size / leads.length) * 100) + ' %)' : ''));
  const upcoming = act.filter((r) => r.slot && r.slot.starts_at > new Date()).length;
  console.log('Budoucí (ještě neproběhlé) schůzky: ' + upcoming);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
