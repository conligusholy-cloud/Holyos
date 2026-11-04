// =============================================================================
// HolyOS — Diagnostika: co AI během hovoru věděla o omezeních provozu
// =============================================================================
// Jen čte, nic nemění. Najde hovory infolinky, ve kterých padlo zadané slovo
// (město, lokalita, jméno), a vypíše přepis + technický log omezení
// (VoiceCall.restrictions_log): jakou lokalitu AI zadala, co HolyOS načetl,
// co se zahodilo jako cizí lokalita a co AI skutečně dostala.
//
// Použití:
//   node scripts/diagnostika-hovor-omezeni.js Svitavy
//   node scripts/diagnostika-hovor-omezeni.js Svitavy --dny 60 --pocet 5

require('dotenv').config();
const { prisma } = require('../config/database');

const args = process.argv.slice(2);
const hledane = args.filter((a) => !a.startsWith('--'))[0] || '';
const opt = (n, d) => { const i = args.indexOf('--' + n); return i > -1 ? (parseInt(args[i + 1], 10) || d) : d; };
const DNY = opt('dny', 30);
const POCET = opt('pocet', 3);

if (!hledane) {
  console.log('Zadejte, co se má v hovorech hledat, např.: node scripts/diagnostika-hovor-omezeni.js Svitavy');
  process.exit(1);
}

const bezDiakritiky = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const cas = (d) => new Date(d).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' });

(async () => {
  const hovory = await prisma.voiceCall.findMany({
    where: { line: 'infolinka', started_at: { gte: new Date(Date.now() - DNY * 86400000) } },
    orderBy: { started_at: 'desc' },
    take: 300,
    select: {
      id: true, started_at: true, duration_sec: true, from_number: true, location: true,
      summary: true, caller_intent: true, transcript: true, restrictions_log: true,
    },
  });

  const jehla = bezDiakritiky(hledane);
  const nalezene = hovory.filter((h) => bezDiakritiky(JSON.stringify([h.location, h.summary, h.caller_intent, h.transcript])).includes(jehla));

  console.log('Hovorů infolinky za ' + DNY + ' dní: ' + hovory.length + ' · obsahuje „' + hledane + '": ' + nalezene.length);

  nalezene.slice(0, POCET).forEach((h) => {
    console.log('\n' + '='.repeat(70));
    console.log(cas(h.started_at) + '  ·  ' + (h.duration_sec || '?') + ' s  ·  ' + (h.from_number || '—'));
    console.log('lokalita z hovoru: ' + (h.location || '—'));
    if (h.summary) console.log('shrnutí: ' + String(h.summary).slice(0, 500));

    console.log('\n--- PŘEPIS ---');
    (h.transcript || []).forEach((t) => console.log('  [' + t.role + '] ' + String(t.text || '').replace(/\s+/g, ' ').slice(0, 400)));

    console.log('\n--- OMEZENÍ PROVOZU: CO AI DOSTALA ---');
    const log = h.restrictions_log;
    if (!Array.isArray(log) || !log.length) {
      console.log('  (žádný záznam — hovor proběhl před nasazením logování, nebo AI nástroj vůbec nezavolala)');
      return;
    }
    log.forEach((z, i) => {
      console.log('  ' + (i + 1) + ') ' + cas(z.at) + ' — AI se ptala na: ' + ((z.dotaz && z.dotaz.lokalita) || '(bez lokality)')
        + (z.dotaz && z.dotaz.zarizeni ? ' / ' + z.dotaz.zarizeni : ''));
      console.log('     identifikováno: ' + (z.machine ? (z.machine.name + ' (ID ' + z.machine.id + ')') : 'NEIDENTIFIKOVÁNO')
        + (z.matched_by ? ' · shoda podle: ' + z.matched_by : ''));
      if (z.nacteno) {
        console.log('     načteno aktivních požadavků: ' + z.nacteno.scanned);
        (z.nacteno.matched || []).forEach((m) => console.log('       ✔ patří sem: #' + m.id + ' ' + m.location + ' [' + m.impact + ', shoda ' + m.matched_by + ']'));
        (z.nacteno.rejected || []).forEach((m) => console.log('       ✘ zahozeno:  #' + m.id + ' ' + m.location + ' [' + m.impact + ']'));
      }
      const p = z.predano || {};
      console.log('     předáno AI: ' + (p.lokalita || '—') + ' · omezení: ' + (p.pocet_omezeni != null ? p.pocet_omezeni : '—')
        + (p.cely_pradlomat_mimo_provoz ? ' · CELÝ PRÁDLOMAT MIMO PROVOZ' : '') + (p.stav ? ' · ' + p.stav : ''));
    });
  });

  await prisma.$disconnect();
})().catch(async (e) => { console.error('Chyba:', e.message); try { await prisma.$disconnect(); } catch (_) {} process.exit(1); });
