// HolyOS — vrácení CRM stavů leadů, které přepsalo odeslání e-mailu / SMS z funelu
// =============================================================================
// Do 17. 10. 2026 odeslání z funelu (šablona „specialista“ / „schůzka“) přepisovalo CRM stav leadu na
// „Odeslán odkaz na specialistu“ / „Odeslána schůzka“ – i u leadů, které měli kolegové rozpracované
// (poptávka financování, schůzka, …). Tenhle skript vrátí PŮVODNÍ stav podle historie změn stavu
// (CompounderEvent 'lead_status' {from, to}, zapisuje services/ads/lead-quality.js každou minutu).
//
// Pravidla (konzervativní):
//  • bere změny stavu NA odeslan_specialista / odeslana_schuzka, které proběhly do 3 min po odeslání z funelu
//    (událost funnel_email / funnel_sms nebo čas *_sent_at u leadu) – tj. udělal je automat, ne člověk
//  • lead musí mít STÁLE ten automatický stav (když ho mezitím kolega změnil, nesahá se na něj)
//  • původní stav = „from“ té změny; řetěz automatických změn se projde zpět až k prvnímu ručnímu stavu
//  • „Odesláno“ se dál eviduje jen systémově v marketing_status (osloven_specialista / osloven_schuzka)
//  • do activity_log leadu zapíše řádek o vrácení
//
// Náhled (nic nezapisuje):
//   DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/restore-lead-statuses-from-history.js
// Ostrý běh:
//   DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/restore-lead-statuses-from-history.js --apply
// Volitelně --since=2026-10-01 (jen změny od data)

const { prisma } = require('../config/database');

const APPLY = process.argv.includes('--apply');
const sinceArg = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8);
const SINCE = sinceArg ? new Date(sinceArg) : new Date('2026-01-01');
const AUTO = ['odeslan_specialista', 'odeslana_schuzka'];
const WIN_BEFORE = 3 * 60 * 1000, WIN_AFTER = 90 * 1000; // změna stavu je zachycena s přesností ~1 min
const LABEL = { new: 'Nový', nedovolano: 'Nedovoláno', volat_pristi: 'Volat příště', contacted: 'Kontaktován', access_sent: 'Odeslán přístup', odeslan_specialista: 'Odeslán odkaz na specialistu', odeslana_schuzka: 'Odeslána schůzka', psal_chatovi: 'Psal chatovi', schuzka: 'Schůzka', schuzka_online: 'Schůzka online', qualified: 'Kvalifikován', dosledovani: 'Dosledování', slibeny_krok: 'Slíbený krok', smlouva_odeslat: 'Smlouva k odeslání', smlouva_odeslana: 'Smlouva odeslána', poptavka_financovani: 'Poptávka financování', prodano: 'Prodáno', converted: 'Konvertován', nezajem: 'Nezájem', nelze_pouzit: 'Nelze použít', rejected: 'Odmítnut' };
const L = (s) => LABEL[s] || s || '—';

(async () => {
  try {
    const changes = await prisma.compounderEvent.findMany({ where: { event: 'lead_status', created_at: { gte: SINCE } }, select: { props: true, created_at: true }, orderBy: { created_at: 'asc' } });
    const byLead = new Map();
    changes.forEach((c) => { const p = c.props || {}; const id = Number(p.lead_id); if (!id) return; if (!byLead.has(id)) byLead.set(id, []); byLead.get(id).push({ from: p.from, to: p.to, t: c.created_at }); });
    const candIds = [...byLead.keys()].filter((id) => byLead.get(id).some((c) => AUTO.includes(c.to)));
    if (!candIds.length) { console.log('Žádné automatické změny stavu nenalezeny.'); await prisma.$disconnect(); return; }

    const leads = await prisma.compounderLead.findMany({ where: { id: { in: candIds } }, select: { id: true, name: true, email: true, status: true, marketing_status: true, activity_log: true, owner_person_id: true,
      ai_specialist_email_sent_at: true, ai_specialist_sms_sent_at: true, schuzka_email_sent_at: true, schuzka_sms_sent_at: true } });
    const sends = await prisma.compounderEvent.findMany({ where: { event: { in: ['funnel_email', 'funnel_sms'] }, sid: { in: candIds.map((i) => 'lead:' + i) } }, select: { sid: true, created_at: true, props: true } });
    const sendTimes = new Map(); sends.forEach((s) => { const id = Number(String(s.sid).slice(5)); if (!sendTimes.has(id)) sendTimes.set(id, []); sendTimes.get(id).push(+s.created_at); });
    leads.forEach((l) => { const a = sendTimes.get(l.id) || []; [l.ai_specialist_email_sent_at, l.ai_specialist_sms_sent_at, l.schuzka_email_sent_at, l.schuzka_sms_sent_at].forEach((d) => { if (d) a.push(+new Date(d)); }); sendTimes.set(l.id, a); });
    const isAutoChange = (id, c) => AUTO.includes(c.to) && (sendTimes.get(id) || []).some((t) => +c.t >= t - WIN_AFTER && +c.t <= t + WIN_BEFORE);

    const plan = [], skipped = [];
    for (const l of leads) {
      const hist = byLead.get(l.id);
      if (!AUTO.includes(l.status)) { skipped.push([l, 'stav už mezitím změněn na „' + L(l.status) + '“']); continue; }
      // poslední změna musí být ta automatická a stav od ní nikdo nezměnil
      let i = hist.length - 1; const last = hist[i];
      if (!last || last.to !== l.status) { skipped.push([l, 'historie nesedí s aktuálním stavem']); continue; }
      if (!isAutoChange(l.id, last)) { skipped.push([l, 'změnu na „' + L(l.status) + '“ neudělal automat (nebyla u odeslání)']); continue; }
      // projdi řetěz automatických změn zpět k prvnímu ručnímu stavu
      let orig = last.from;
      while (i > 0 && AUTO.includes(orig) && isAutoChange(l.id, hist[i - 1]) && hist[i - 1].to === orig) { i--; orig = hist[i].from; }
      if (!orig || AUTO.includes(orig)) { skipped.push([l, 'původní stav není známý (lead vznikl až s tímto stavem)']); continue; }
      plan.push({ l, to: orig, at: hist[i].t, mkt: l.marketing_status || (l.status === 'odeslana_schuzka' ? 'osloven_schuzka' : 'osloven_specialista') });
    }

    const sum = {}; plan.forEach((p) => { const k = L(p.l.status) + ' → ' + L(p.to); sum[k] = (sum[k] || 0) + 1; });
    console.log('K vrácení:', plan.length); Object.keys(sum).forEach((k) => console.log('  ' + sum[k] + '× ' + k));
    console.log('\nSeznam:'); plan.forEach((p) => console.log('  #' + p.l.id + ' ' + (p.l.name || p.l.email || '') + ' · ' + L(p.l.status) + ' → ' + L(p.to) + ' · přepsáno ' + new Date(p.at).toLocaleString('cs-CZ')));
    console.log('\nPřeskočeno:', skipped.length); skipped.slice(0, 60).forEach(([l, why]) => console.log('  #' + l.id + ' ' + (l.name || l.email || '') + ' — ' + why));
    if (!APPLY) { console.log('\n[NÁHLED] Nic se nezapsalo. Pro zápis přidej --apply.'); await prisma.$disconnect(); return; }

    const stamp = new Date().toLocaleString('cs-CZ'); let n = 0;
    for (const p of plan) {
      const line = '[' + stamp + '] ↩ Stav vrácen z „' + L(p.l.status) + '“ na „' + L(p.to) + '“ (odeslání z funelu ' + new Date(p.at).toLocaleString('cs-CZ') + ' omylem přepsalo stav; odeslání vedeno jen systémově)';
      await prisma.compounderLead.update({ where: { id: p.l.id }, data: { status: p.to, marketing_status: p.mkt, activity_log: line + (p.l.activity_log ? '\n' + p.l.activity_log : '') } });
      n++;
    }
    console.log('\n✅ Vráceno:', n);
    await prisma.$disconnect();
  } catch (e) { console.error('Chyba:', e.message); try { await prisma.$disconnect(); } catch (_) {} process.exit(1); }
})();
