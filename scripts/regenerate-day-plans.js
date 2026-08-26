// HolyOS — přegeneruje DNEŠNÍ plán (Dnešní plán) všem aktivním obchodníkům.
// Použij po hromadných změnách (např. doplnění dosledování), ať se plán hned promítne.
//
// SPUSŤ LOKÁLNĚ proti Railway DB (ANTHROPIC_API_KEY volitelný — bez něj se použije fallback):
//   $env:DATABASE_URL = $env:DATABASE_PUBLIC_URL
//   node scripts/regenerate-day-plans.js
const sm = require('../services/ai/sales-manager');

(async function () {
  const people = await sm.getActiveSalespeople();
  const day = sm.tzTodayStr();
  console.log('Přegenerovávám plán na ' + day + ' pro ' + people.length + ' obchodníků…');
  for (const p of people) {
    try {
      const r = await sm.planDay(p.id, day, { force: true });
      const n = (r && r.plan && Array.isArray(r.plan.tasks)) ? r.plan.tasks.length : (r && r.created);
      console.log('  ✓ ' + (p.name || ('#' + p.id)) + ' → ' + (n != null ? n + ' úkolů' : 'ok'));
    } catch (e) {
      console.error('  ✗ ' + (p.name || ('#' + p.id)) + ': ' + (e && e.message));
    }
  }
  console.log('Hotovo — obchodníci uvidí nový plán po „Obnovit" na obrazovce Dnes.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
