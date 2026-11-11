// =============================================================================
// HolyOS — Obchod: domluvená schůzka přebíjí starší kroky u kontaktu
// =============================================================================
//
// Když se s kontaktem domluví schůzka, starší otevřené „zavolej" a „dosleduj"
// kroky jsou bezpředmětné — dalším krokem je ta schůzka. Bez tohohle úklidu
// zůstanou v kalendáři viset jako PROŠVIHNUTO a plánovač dne obchodníkovi
// pořád nabízí „Dosledovat (nedovoláno)", přestože je schůzka naplánovaná.
//
// Stejnou logiku má už `POST /api/sales/events` (nová domluva ruší starší),
// ale rezervace schůzky z webu / od majitele jde jinudy — tam se měnil jen
// stav kontaktu. Tenhle helper to srovnává.
//
// POZOR: události typu `task` („slíbený krok") se NERUŠÍ. Co obchodník
// zákazníkovi slíbil, má splnit i když je schůzka domluvená.
// =============================================================================

const { prisma: defaultPrisma } = require('../../config/database');

// Typy kroků, které domluvená schůzka přebíjí.
const PREBIJENE_TYPY = ['call', 'followup'];
const OTEVRENE = { notIn: ['done', 'cancelled', 'canceled'] };

/**
 * Zavře otevřené hovory a dosledování u kontaktu, který má domluvenou schůzku.
 *
 * @param leadId — CompounderLead.id
 * @param opts   — { prisma?, duvod?, exceptEventId? }
 * @returns { events, tasks } — počty zavřených záznamů
 */
async function closeStepsSupersededByMeeting(leadId, opts = {}) {
  const prisma = opts.prisma || defaultPrisma;
  const id = parseInt(leadId, 10);
  if (!Number.isInteger(id)) return { events: 0, tasks: 0 };
  const duvod = opts.duvod || 'Nahrazeno domluvenou schůzkou';

  let events = 0;
  let tasks = 0;
  try {
    const whereEv = { compounder_lead_id: id, status: OTEVRENE, event_type: { in: PREBIJENE_TYPY } };
    if (opts.exceptEventId) whereEv.id = { not: parseInt(opts.exceptEventId, 10) };
    const ev = await prisma.salesEvent.updateMany({ where: whereEv, data: { status: 'cancelled' } });
    events = (ev && ev.count) || 0;
  } catch (e) {
    console.warn('[obchod] úklid kroků po domluvení schůzky (události):', e.message);
  }

  try {
    // Úkol v dnešním plánu se tím nepočítá jako splněný — jen se odloží jako
    // bezpředmětný, ať obchodníkovi nesedí ve frontě. Statistiky hovorů to
    // neovlivní (skipped se nepočítá jako hovor).
    const t = await prisma.salesTask.updateMany({
      where: { lead_id: id, status: 'open', kind: { in: PREBIJENE_TYPY } },
      data: { status: 'skipped', skipped_reason: duvod },
    });
    tasks = (t && t.count) || 0;
  } catch (e) {
    console.warn('[obchod] úklid kroků po domluvení schůzky (úkoly):', e.message);
  }

  return { events, tasks };
}

module.exports = { closeStepsSupersededByMeeting, PREBIJENE_TYPY };
