// =============================================================================
// HolyOS — Compounder: JEDNORÁZOVÉ doposlání e-mailů se ztrátou
// =============================================================================
// Rozešle e-mail se ztrátou podle standardních pravidel (worker.runNow), ale
// PŘESKOČÍ leady, kterým e-mail odešel za posledních N hodin (default 48) — takže
// se nepošle duplicita těm, kdo ho dostali ve čtvrteční rozesílce.
//
// Pravidla (hlídá sdílená funkce sendLossEmailForLead): lead musí mít e-mail, musel
// být v portálu (portal_view), nesmí vlastnit lokalitu a musí jít spočítat nenulový
// roční výnos (z modelu, nebo z celé nabídky). VYŽADUJE běžící SIS — jinak výnos 0.
//
// Spuštění (lokálně proti Railway DB — DATABASE_URL a mail/SIS/AI env v .env):
//   node scripts/send-loss-emails-catchup.js                 (DRY-RUN — nic neodešle)
//   node scripts/send-loss-emails-catchup.js --apply         (opravdu rozešle)
//   node scripts/send-loss-emails-catchup.js --apply --skip-hours 24

'use strict';

const fs = require('fs');
const path = require('path');
// Načti .env, aby šlo spustit ručně (DATABASE_URL a další env musí být před require).
try {
  const t = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  t.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  });
} catch (e) { /* .env nemusí existovat */ }

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
function argVal(flag, def) { const i = args.indexOf(flag); return (i !== -1 && args[i + 1]) ? args[i + 1] : def; }
const SKIP_HOURS = Number(argVal('--skip-hours', '48')) || 48;

(async function () {
  console.log(`\n=== Doposlání e-mailů se ztrátou ===`);
  console.log(`Režim: ${APPLY ? 'APPLY (opravdu rozešle)' : 'DRY-RUN (nic se neodešle)'}`);
  console.log(`Přeskočit ty, komu e-mail odešel za posledních: ${SKIP_HOURS} h\n`);

  const worker = require('../services/compounder/loss-email-worker');
  const r = await worker.runNow({ skipSentWithinHours: SKIP_HOURS, dryRun: !APPLY });

  console.log(`\n=== Výsledek ===`);
  console.log(JSON.stringify(r, null, 2));
  if (!APPLY) {
    console.log(`\nToto byl DRY-RUN — nikdo nedostal e-mail. „wouldAttempt" je počet leadů, u kterých`);
    console.log(`se odeslání zkusí; finální strážce (byl v portálu / nevlastní lokalitu / spočitatelný`);
    console.log(`výnos) se uplatní až při reálném běhu. Pro skutečné odeslání spusť s --apply.`);
  }
  process.exit(0);
})().catch((e) => { console.error('Chyba:', e); process.exit(1); });
