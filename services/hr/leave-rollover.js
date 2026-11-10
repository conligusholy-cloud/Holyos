// =============================================================================
// HolyOS — Hromadný přepočet nároku na dovolenou (požadavek #139)
// =============================================================================
// K datu nastavenému v „Nastavení dovolených" (LeaveSettings.effective_from)
// se každému aktivnímu zaměstnanci:
//   • nárok (leave_entitlement_days) srovná na výchozí hodnotu z nastavení,
//   • převod (leave_carryover) naplní nevyčerpanými dny z předchozího období,
//     omezenými na carryover_max_days (a nulovými, když je převod vypnutý),
//   • leave_entitlement_from nastaví na datum přepočtu.
//
// Ruční nárok zadaný v kartě zaměstnance platí jen do nejbližšího přepočtu —
// ten srovná všechny (potvrzeno zadavatelem).
//
// Přepočet je idempotentní: po doběhnutí se datum zapíše do last_applied_from
// a podruhé už pro stejné datum neproběhne.
'use strict';

const { prisma } = require('../../config/database');

const DEN = 24 * 60 * 60 * 1000;

// Pořadové číslo dne v UTC — počty dní tak nerozhodí letní čas.
function denCislo(d) {
  const x = new Date(d);
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()) / DEN;
}

// Půlnoc UTC daného dne (Prisma @db.Date).
function naDen(d) {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

// Počet dní úseku oříznutého na interval <od, do>, včetně krajních dnů.
function dnuVObdobi(odUseku, doUseku, od, doData) {
  const a = Math.max(denCislo(odUseku), denCislo(od));
  const b = Math.min(denCislo(doUseku), denCislo(doData));
  return b >= a ? b - a + 1 : 0;
}

// Začátek předchozího období = od kdy zaměstnanci běžel dosavadní nárok.
// Primárně jeho vlastní leave_entitlement_from, jinak 1. 1. roku před přepočtem.
function zacatekObdobi(person, ucinnostOd) {
  if (person.leave_entitlement_from) {
    const z = naDen(person.leave_entitlement_from);
    if (denCislo(z) < denCislo(ucinnostOd)) return z;
  }
  const u = new Date(ucinnostOd);
  return new Date(Date.UTC(u.getUTCFullYear() - 1, u.getUTCMonth(), u.getUTCDate()));
}

// Spočítá, co zaměstnanci z předchozího období zbylo (nikdy ne záporné číslo).
function zbyvaZObdobi(person, od, doData) {
  const narok = person.leave_entitlement_days == null ? 0 : person.leave_entitlement_days;
  const prevod = person.leave_carryover || 0;
  let cerpano = 0;
  for (const lr of person.leave_requests) {
    cerpano += dnuVObdobi(lr.date_from, lr.date_to, od, doData);
  }
  return Math.max(0, narok + prevod - cerpano);
}

// Kolik dní se smí převést podle nastavení.
function omezPrevod(zbyva, settings) {
  if (!settings.carryover_allowed) return 0;
  const max = settings.carryover_max_days == null ? 0 : settings.carryover_max_days;
  return Math.max(0, Math.min(zbyva, max));
}

// Jádro přepočtu. `db` kvůli testovatelnosti (lze podstrčit transakci).
async function prepocitej(ucinnostOd, settings, db = prisma) {
  const ucinnost = naDen(ucinnostOd);
  // Konec předchozího období je den před účinností nového nároku.
  const konecMinula = new Date(ucinnost.getTime() - DEN);

  const lide = await db.person.findMany({
    where: { active: true, type: 'employee' },
    select: {
      id: true,
      leave_entitlement_days: true,
      leave_carryover: true,
      leave_entitlement_from: true,
      leave_requests: {
        where: { status: 'approved', date_from: { lte: konecMinula } },
        select: { date_from: true, date_to: true },
      },
    },
  });

  const zmeny = [];
  for (const p of lide) {
    const od = zacatekObdobi(p, ucinnost);
    const zbyva = zbyvaZObdobi(p, od, konecMinula);
    zmeny.push({
      id: p.id,
      leave_entitlement_days: settings.default_entitlement_days,
      leave_carryover: omezPrevod(zbyva, settings),
      leave_entitlement_from: ucinnost,
    });
  }

  // Jedna transakce — buď se přepočítají všichni, nebo nikdo.
  await db.$transaction([
    ...zmeny.map((z) => db.person.update({
      where: { id: z.id },
      data: {
        leave_entitlement_days: z.leave_entitlement_days,
        leave_carryover: z.leave_carryover,
        leave_entitlement_from: z.leave_entitlement_from,
      },
    })),
    db.leaveSettings.update({ where: { id: 1 }, data: { last_applied_from: ucinnost } }),
  ]);

  return { ok: true, pocet: zmeny.length, ucinnost_od: ucinnost };
}

// Proběhl už přepočet pro tohle datum?
function jizProbehl(settings) {
  if (!settings.effective_from || !settings.last_applied_from) return false;
  return denCislo(settings.last_applied_from) >= denCislo(settings.effective_from);
}

// Spustí přepočet, pokud je nastavené datum už dosažené a ještě neproběhl.
// Vrací null, když není co dělat.
async function spustPokudJeCas(db = prisma) {
  const settings = await db.leaveSettings.findFirst({ where: { id: 1 } });
  if (!settings || !settings.effective_from) return null;
  if (jizProbehl(settings)) return null;
  if (denCislo(settings.effective_from) > denCislo(new Date())) return null; // datum v budoucnu
  return prepocitej(settings.effective_from, settings, db);
}

module.exports = {
  prepocitej, spustPokudJeCas, jizProbehl,
  // export kvůli testům
  _vnitrni: { denCislo, naDen, dnuVObdobi, zacatekObdobi, zbyvaZObdobi, omezPrevod },
};
