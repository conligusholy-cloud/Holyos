// =============================================================================
// HolyOS — HR routes (lidé, oddělení, role, docházka, dovolená)
// =============================================================================

const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { requireHrWrite, stripSensitive, canSeeSensitive, requireLeaveEdit, canEditLeave, requireCompanyLeaveEdit, canEditCompanyLeave } = require('../middleware/hr-access');
const { logAudit: _logAuditHr } = require('../services/audit');
const { logAudit, diffObjects, makeSnapshot } = require('../services/audit');
const { z } = require('zod');
const { workingDaysInMonth, workingDaysInYear } = require('../services/cz-svatky');

// ─── Časové zóny ────────────────────────────────────────────────────────
// Node proces na Railway běží v UTC, ale docházka musí být v Europe/Prague.
// Helper vrací Prague-lokální kalendářní den (UTC půlnoc pro Prisma @db.Date)
// a aktuální HH:MM v pražském čase — používej místo new Date().getHours() apod.
const PRAGUE_TZ = 'Europe/Prague';
function nowInPrague() {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRAGUE_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce((a, p) => {
    if (p.type !== 'literal') a[p.type] = p.value;
    return a;
  }, {});
  const year = parseInt(parts.year, 10);
  const month = parseInt(parts.month, 10); // 1-12
  const day = parseInt(parts.day, 10);
  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  // UTC půlnoc pražského kalendářního dne — vhodné pro Prisma @db.Date
  const today = new Date(Date.UTC(year, month - 1, day));
  const timeStr = `${parts.hour}:${parts.minute}`;
  return { today, timeStr, year, month, day, hour, minute };
}

// ─── KIOSEK (příchod/odchod přes čip — BEZ autentizace) ─────────────────
// Kiosk endpointy jsou PŘED requireAuth, protože čip je autentizace

// POST /api/hr/kiosk/identify — identifikace osoby čipem
router.post('/kiosk/identify', async (req, res, next) => {
  try {
    const { chip_id, person_id } = req.body;
    if (!chip_id && !person_id) return res.status(400).json({ error: 'Chybí chip_id nebo person_id' });

    let person;
    if (person_id) {
      // Přímé hledání podle ID (návrat z nepřítomnosti)
      person = await prisma.person.findFirst({
        where: { id: parseInt(person_id), active: true },
        select: {
          id: true, first_name: true, last_name: true, photo_url: true,
          employee_number: true,
          department: { select: { id: true, name: true } },
          shift: true,
        },
      });
    } else {
      // Hledáme podle chip_number NEBO chip_card_id (BEZ filtru na active —
      // pokud čip patří bývalému zaměstnanci, chceme to rozlišit od neznámého čipu)
      person = await prisma.person.findFirst({
        where: {
          OR: [
            { chip_number: chip_id },
            { chip_card_id: chip_id },
          ],
        },
        select: {
          id: true, first_name: true, last_name: true, photo_url: true,
          employee_number: true, active: true, end_date: true,
          department: { select: { id: true, name: true } },
          shift: true,
        },
      });
    }

    if (!person) return res.status(404).json({ error: 'Osoba nenalezena', code: 'chip_unknown' });

    // Čip patří bývalému zaměstnanci — neaktivní nebo už skončil pracovní poměr
    if (chip_id) {
      const todayDate = nowInPrague().today;
      const employmentEnded = person.active === false
        || (person.end_date && new Date(person.end_date) < todayDate);
      if (employmentEnded) {
        return res.status(403).json({
          error: 'Pracovní poměr ukončen',
          code: 'employment_ended',
          person_name: `${person.first_name} ${person.last_name}`,
        });
      }
    }

    // Zjistit dnešní stav docházky (pražský kalendářní den)
    const { today, hour: pragueNowHour, minute: pragueNowMinute } = nowInPrague();

    const todayAttendance = await prisma.attendance.findFirst({
      where: { person_id: person.id, date: today },
      orderBy: { created_at: 'desc' },
    });

    // Zjistit aktivní nepřítomnost
    const activeAbsence = await prisma.attendance.findFirst({
      where: {
        person_id: person.id,
        date: today,
        type: { not: 'work' },
        clock_out: null,
      },
    });

    // Zjistit otevřený příchod do práce (type=work, clock_out=null)
    const openWork = await prisma.attendance.findFirst({
      where: { person_id: person.id, date: today, type: 'work', clock_out: null },
    });

    const name = `${person.first_name} ${person.last_name}`;
    const role = person.department?.name || 'Zaměstnanec';
    const is_absent = !!activeAbsence;
    const is_clocked_in = !!openWork;

    let status = null;
    if (todayAttendance) {
      if (todayAttendance.clock_out && todayAttendance.type === 'work') {
        status = `Odchod zaznamenán v ${todayAttendance.clock_out}`;
      } else if (todayAttendance.type === 'work' && !todayAttendance.clock_out) {
        status = `Příchod v ${todayAttendance.clock_in}`;
      } else if (todayAttendance.type !== 'work') {
        status = `Nepřítomnost: ${todayAttendance.type} od ${todayAttendance.clock_in}`;
      }
    }

    // Dnešní přestávky (svačina, oběd)
    const todayBreaks = await prisma.attendance.findMany({
      where: {
        person_id: person.id,
        date: today,
        type: { in: ['break_snack_out', 'break_lunch_out'] },
      },
      orderBy: { clock_in: 'asc' },
    });

    const breakMinutes = person.shift ? person.shift.break_minutes : 30;
    const nowTime = new Date();
    const breaks = todayBreaks.map(b => {
      let duration = null;
      let isOpen = !b.clock_out;
      if (b.clock_out) {
        const [ih, im] = b.clock_in.split(':').map(Number);
        const [oh, om] = b.clock_out.split(':').map(Number);
        duration = (oh * 60 + om) - (ih * 60 + im);
      } else {
        // Stále na přestávce — počítat od clock_in do teď (pražský čas)
        const [ih, im] = b.clock_in.split(':').map(Number);
        duration = (pragueNowHour * 60 + pragueNowMinute) - (ih * 60 + im);
      }
      const breakType = b.type === 'break_snack_out' ? 'snack' : 'lunch';
      return { type: breakType, clock_in: b.clock_in, clock_out: b.clock_out, duration, is_open: isOpen };
    });

    // Celková doba přestávek
    const totalBreakMinutes = breaks.reduce((sum, b) => sum + (b.duration || 0), 0);
    const breakOverLimit = totalBreakMinutes > breakMinutes;

    // Přesčasy — jednoduchý výpočet pro aktuální měsíc
    const dailyFund = person.shift ? parseFloat(person.shift.hours_fund) : 8.0;
    const monthStart = new Date(nowTime.getFullYear(), nowTime.getMonth(), 1);
    const monthEnd = new Date(nowTime.getFullYear(), nowTime.getMonth() + 1, 0);

    let pastWorkingDays = 0;
    const yesterday = new Date(nowTime);
    yesterday.setDate(yesterday.getDate() - 1);
    for (let d = new Date(monthStart); d <= yesterday; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow >= 1 && dow <= 5) pastWorkingDays++;
    }

    const workRecords = await prisma.attendance.findMany({
      where: { person_id: person.id, date: { gte: monthStart, lte: monthEnd }, type: 'work' },
    });

    let workedMinutes = 0;
    for (const r of workRecords) {
      if (r.clock_in && r.clock_out) {
        const [ih, im] = r.clock_in.split(':').map(Number);
        const [oh, om] = r.clock_out.split(':').map(Number);
        const mins = (oh * 60 + om) - (ih * 60 + im) - (r.break_minutes || breakMinutes);
        if (mins > 0) workedMinutes += mins;
      }
    }

    const workedHours = Math.round((workedMinutes / 60) * 100) / 100;
    const expectedHours = Math.round(pastWorkingDays * dailyFund * 100) / 100;
    const overtimeHours = Math.round((workedHours - expectedHours) * 100) / 100;

    res.json({
      id: person.id,
      name,
      role,
      photo: person.photo_url,
      status,
      is_absent,
      is_clocked_in,
      today_attendance: todayAttendance,
      breaks,
      total_break_minutes: totalBreakMinutes,
      allowed_break_minutes: breakMinutes,
      break_over_limit: breakOverLimit,
      overtime: {
        worked_hours: workedHours,
        expected_hours: expectedHours,
        overtime_hours: overtimeHours,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/kiosk/clock — příchod/odchod/nepřítomnost
router.post('/kiosk/clock', async (req, res, next) => {
  try {
    const { person_id, action, absence_type } = req.body;
    // action: 'clock_in' | 'clock_out' | 'absence_out' | 'absence_in'

    if (!person_id || !action) {
      return res.status(400).json({ error: 'Chybí person_id nebo action' });
    }

    // Pražský kalendářní den + lokální HH:MM (Node na Railway je UTC)
    const { today, timeStr } = nowInPrague();

    let record;

    switch (action) {
      case 'clock_in': {
        // Kontrola duplicity — existuje otevřený příchod?
        const openRecord = await prisma.attendance.findFirst({
          where: { person_id: parseInt(person_id), date: today, clock_out: null, type: 'work' },
        });
        if (openRecord) {
          return res.status(400).json({ error: 'Příchod již zaznamenán, nejdříve odejděte' });
        }

        record = await prisma.attendance.create({
          data: {
            person_id: parseInt(person_id),
            date: today,
            clock_in: timeStr,
            type: 'work',
          },
        });
        res.status(201).json(record);
        break;
      }

      case 'clock_out': {
        const existing = await prisma.attendance.findFirst({
          where: { person_id: parseInt(person_id), date: today, clock_out: null, type: 'work' },
          orderBy: { clock_in: 'desc' },
        });
        if (!existing) {
          return res.status(404).json({ error: 'Žádný otevřený příchod k uzavření' });
        }

        record = await prisma.attendance.update({
          where: { id: existing.id },
          data: { clock_out: timeStr },
        });
        res.json(record);
        break;
      }

      case 'absence_out': {
        if (!absence_type) {
          return res.status(400).json({ error: 'Chybí typ nepřítomnosti (absence_type)' });
        }

        // Kontrola — nesmí být jiná otevřená nepřítomnost/přestávka
        const activeAbsence = await prisma.attendance.findFirst({
          where: {
            person_id: parseInt(person_id),
            date: today,
            clock_out: null,
            type: { not: 'work' },
          },
        });
        if (activeAbsence) {
          return res.status(400).json({ error: `Již máte otevřenou nepřítomnost (${activeAbsence.type}). Nejdříve se vraťte.` });
        }

        record = await prisma.attendance.create({
          data: {
            person_id: parseInt(person_id),
            date: today,
            clock_in: timeStr,
            type: absence_type,
            note: `Kiosek: ${absence_type}`,
          },
        });
        res.status(201).json(record);
        break;
      }

      case 'absence_in': {
        // Najít otevřenou nepřítomnost a uzavřít ji
        const openAbsence = await prisma.attendance.findFirst({
          where: {
            person_id: parseInt(person_id),
            date: today,
            clock_out: null,
            type: { not: 'work' },
          },
          orderBy: { clock_in: 'desc' },
        });
        if (!openAbsence) {
          return res.status(404).json({ error: 'Žádná otevřená nepřítomnost' });
        }

        record = await prisma.attendance.update({
          where: { id: openAbsence.id },
          data: { clock_out: timeStr },
        });
        res.json(record);
        break;
      }

      default:
        return res.status(400).json({ error: `Neplatná akce: ${action}. Povoleno: clock_in, clock_out, absence_out, absence_in` });
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/hr/kiosk/absence-types — typy nepřítomností (pro kiosk menu)
router.get('/kiosk/absence-types', async (req, res, next) => {
  try {
    const types = await prisma.absenceType.findMany({
      orderBy: { name: 'asc' },
    });
    res.json(types);
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/kiosk/leave-request — žádost o dovolenou z kiosku
router.post('/kiosk/leave-request', async (req, res, next) => {
  try {
    const { person_id, type, date_from, date_to, note } = req.body;

    if (!person_id || !type || !date_from || !date_to) {
      return res.status(400).json({ error: 'Chybí povinné údaje (person_id, type, date_from, date_to)' });
    }

    const zamestnanec = await prisma.person.findUnique({
      where: { id: parseInt(person_id) },
      select: { id: true, first_name: true, last_name: true, supervisor_id: true },
    });
    if (!zamestnanec) return res.status(400).json({ error: 'Zaměstnanec neexistuje' });

    const request = await prisma.leaveRequest.create({
      data: {
        person_id: zamestnanec.id,
        type,
        date_from: new Date(date_from),
        date_to: new Date(date_to),
        note: note || null,
        status: 'pending',
      },
      include: { person: { select: { id: true, first_name: true, last_name: true, supervisor_id: true } } },
    });

    // Stejně jako u žádosti z webu — jinak o žádosti z kiosku nikdo neví,
    // dokud si někdo sám neotevře seznam. (Požadavek #136)
    await notifikujSchvalovatele(request, zamestnanec);

    res.status(201).json(request);
  } catch (err) {
    next(err);
  }
});

// GET /api/hr/kiosk/my-leave-requests — žádosti o dovolenou pro osobu
router.get('/kiosk/my-leave-requests', async (req, res, next) => {
  try {
    const { person_id } = req.query;
    if (!person_id) return res.status(400).json({ error: 'Chybí person_id' });

    const requests = await prisma.leaveRequest.findMany({
      where: { person_id: parseInt(person_id) },
      orderBy: { created_at: 'desc' },
      take: 10,
    });

    res.json(requests);
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/kiosk/break — zaznamenání přestávky (svačina, oběd)
router.post('/kiosk/break', async (req, res, next) => {
  try {
    const { person_id, break_type } = req.body;
    // break_type: break_snack_out, break_snack_in, break_lunch_out, break_lunch_in

    if (!person_id || !break_type) {
      return res.status(400).json({ error: 'Chybí person_id nebo break_type' });
    }

    // Pražský kalendářní den + lokální HH:MM (Node na Railway je UTC)
    const { today, timeStr } = nowInPrague();

    const breakLabels = {
      break_snack_out: 'Svačina',
      break_snack_in: 'Svačina',
      break_lunch_out: 'Oběd',
      break_lunch_in: 'Oběd',
    };

    const breakName = breakLabels[break_type] || 'Přestávka';
    const isOut = break_type.endsWith('_out');

    if (isOut) {
      // Kontrola — nesmí být jiná otevřená nepřítomnost/přestávka
      const activeAbsence = await prisma.attendance.findFirst({
        where: {
          person_id: parseInt(person_id),
          date: today,
          clock_out: null,
          type: { not: 'work' },
        },
      });
      if (activeAbsence) {
        return res.status(400).json({ error: `Již máte otevřenou nepřítomnost (${activeAbsence.type}). Nejdříve se vraťte.` });
      }

      // Odchod na přestávku — vytvořit nový záznam
      const record = await prisma.attendance.create({
        data: {
          person_id: parseInt(person_id),
          date: today,
          clock_in: timeStr,
          type: break_type,
          note: `${breakName} — odchod`,
        },
      });
      res.status(201).json(record);
    } else {
      // Návrat z přestávky — uzavřít otevřený záznam
      const outType = break_type.replace('_in', '_out');
      const openBreak = await prisma.attendance.findFirst({
        where: {
          person_id: parseInt(person_id),
          date: today,
          type: outType,
          clock_out: null,
        },
        orderBy: { clock_in: 'desc' },
      });

      if (!openBreak) {
        return res.status(404).json({ error: `Žádný otevřený odchod na ${breakName.toLowerCase()}` });
      }

      const record = await prisma.attendance.update({
        where: { id: openBreak.id },
        data: {
          clock_out: timeStr,
          note: `${breakName} — ${timeStr}`,
        },
      });
      res.json(record);
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/hr/kiosk/overtime?person_id= — výpočet přesčasů aktuálního měsíce
router.get('/kiosk/overtime', async (req, res, next) => {
  try {
    const { person_id } = req.query;
    if (!person_id) return res.status(400).json({ error: 'Chybí person_id' });

    const personId = parseInt(person_id);

    // Načíst osobu se směnou
    const person = await prisma.person.findUnique({
      where: { id: personId },
      include: { shift: true },
    });

    if (!person) return res.status(404).json({ error: 'Osoba nenalezena' });

    const dailyFund = person.shift ? parseFloat(person.shift.hours_fund) : 8.0;
    const breakMins = person.shift ? person.shift.break_minutes : 30;

    // Aktuální měsíc
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Počet pracovních dnů v měsíci (Po-Pá)
    let workingDays = 0;
    const daysCounted = new Date(monthEnd);
    for (let d = new Date(monthStart); d <= daysCounted; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow >= 1 && dow <= 5) workingDays++;
    }

    const expectedHours = workingDays * dailyFund;

    // Načíst záznamy docházky (pouze typ 'work')
    const records = await prisma.attendance.findMany({
      where: {
        person_id: personId,
        date: { gte: monthStart, lte: monthEnd },
        type: 'work',
      },
    });

    // Spočítat odpracované hodiny
    let workedMinutes = 0;
    let daysWorked = 0;

    for (const r of records) {
      if (r.clock_in && r.clock_out) {
        const [ih, im] = r.clock_in.split(':').map(Number);
        const [oh, om] = r.clock_out.split(':').map(Number);
        const mins = (oh * 60 + om) - (ih * 60 + im) - (r.break_minutes || breakMins);
        if (mins > 0) workedMinutes += mins;
        daysWorked++;
      }
    }

    const workedHours = workedMinutes / 60;
    // Přesčasy = odpracováno - očekáváno (pouze za dny, které už proběhly)
    // Počítáme fond jen za uplynulé pracovní dny
    let pastWorkingDays = 0;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    for (let d = new Date(monthStart); d <= yesterday; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow >= 1 && dow <= 5) pastWorkingDays++;
    }

    const expectedSoFar = pastWorkingDays * dailyFund;
    const overtimeHours = workedHours - expectedSoFar;

    // Načíst schválené převody přesčasů pro tento měsíc
    let transferredHours = 0;
    try {
      const transfers = await prisma.overtimeRequest.findMany({
        where: { person_id: personId, month: monthStr, status: 'approved' },
      });
      transferredHours = transfers.reduce((sum, t) => sum + parseFloat(t.hours), 0);
    } catch (e) {
      // Tabulka možná ještě neexistuje
    }

    // Načíst čekající žádosti
    let pendingRequests = [];
    try {
      pendingRequests = await prisma.overtimeRequest.findMany({
        where: { person_id: personId, status: 'pending' },
        orderBy: { created_at: 'desc' },
        take: 5,
      });
    } catch (e) {
      // Tabulka možná ještě neexistuje
    }

    res.json({
      month: monthStr,
      daily_fund: dailyFund,
      working_days: workingDays,
      past_working_days: pastWorkingDays,
      expected_hours: Math.round(expectedSoFar * 100) / 100,
      expected_hours_total: Math.round(expectedHours * 100) / 100,
      worked_hours: Math.round(workedHours * 100) / 100,
      overtime_hours: Math.round(overtimeHours * 100) / 100,
      transferred_hours: Math.round(transferredHours * 100) / 100,
      net_overtime: Math.round((overtimeHours - transferredHours) * 100) / 100,
      days_worked: daysWorked,
      pending_requests: pendingRequests,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/kiosk/overtime-request — žádost o převod přesčasů
router.post('/kiosk/overtime-request', async (req, res, next) => {
  try {
    const { person_id, hours, type, note } = req.body;
    // type: 'transfer_to_leave' (přesčas→volno), 'transfer_to_pay' (přesčas→peníze), 'debt_work' (odpracování dluhu)

    if (!person_id || hours === undefined || !type) {
      return res.status(400).json({ error: 'Chybí person_id, hours nebo type' });
    }

    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const request = await prisma.overtimeRequest.create({
      data: {
        person_id: parseInt(person_id),
        hours: parseFloat(hours),
        type,
        note: note || null,
        status: 'pending',
        month: monthStr,
      },
    });

    res.status(201).json(request);
  } catch (err) {
    next(err);
  }
});

// ─── KONEC KIOSKU ───────────────────────────────────────────────────────

// Všechny následující HR routy vyžadují autentizaci
router.use(requireAuth);

// ─── LIDÉ ──────────────────────────────────────────────────────────────────

// Rekonciliace „bývalých zaměstnanců": komu skončil pracovní poměr (end_date v
// minulosti) → type 'former'; komu se datum smaže/posune do budoucna a byl 'former'
// → zpět 'employee'. Volá se před čtením lidí/statistik, ať je stav vždy aktuální
// bez nutnosti cronu. (Požadavek #102)
async function reconcileFormerEmployees() {
  const { today } = nowInPrague(); // pražský den, ne lokální půlnoc procesu (Požadavek #134)
  try {
    await prisma.person.updateMany({
      where: { type: 'employee', end_date: { lt: today } },
      data: { type: 'former' },
    });
    await prisma.person.updateMany({
      where: { type: 'former', OR: [{ end_date: null }, { end_date: { gte: today } }] },
      data: { type: 'employee' },
    });
  } catch (e) { console.warn('[hr] reconcileFormerEmployees:', e.message); }
}

// GET /api/hr/people
router.get('/people', async (req, res, next) => {
  try {
    await reconcileFormerEmployees();
    const { search, type, department_id, active, include_former } = req.query;

    const where = {};
    // Bývalí zaměstnanci (type 'former') se ve výchozím výpisu nezobrazují —
    // zmizí ze seznamu HR lidí i z organizační struktury a nepočítají se do
    // statistik. Zůstávají dostupní v archivu přes explicitní ?type=former
    // (případně ?include_former=1 pro kompletní výpis). (Požadavek #103)
    if (type) {
      where.type = type;
    } else if (!(include_former === 'true' || include_former === '1')) {
      where.type = { not: 'former' };
    }
    if (department_id) where.department_id = parseInt(department_id);
    if (active !== undefined) where.active = active === 'true' || active === '1';
    if (search) {
      where.OR = [
        { first_name: { contains: search, mode: 'insensitive' } },
        { last_name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { employee_number: { contains: search, mode: 'insensitive' } },
      ];
    }

    const people = await prisma.person.findMany({
      where,
      include: {
        department: true,
        role: true,
        shift: true,
        company: true,
        supervisor: { select: { id: true, first_name: true, last_name: true } },
      },
      orderBy: { last_name: 'asc' },
    });

    // Citlivé údaje (RČ, OP, účet, mzda) jen pro admina / HR s právem úpravy / osobu samu
    const out = [];
    for (const pp of people) out.push((await canSeeSensitive(req.user, pp.id)) ? pp : stripSensitive(pp));
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// GET /api/hr/people/:id
router.get('/people/:id', async (req, res, next) => {
  try {
    const person = await prisma.person.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        department: true,
        role: true,
        shift: true,
        company: true,
        supervisor: { select: { id: true, first_name: true, last_name: true } },
        subordinates: { select: { id: true, first_name: true, last_name: true } },
        documents: { orderBy: { created_at: 'desc' } },
      },
    });

    if (!person) return res.status(404).json({ error: 'Osoba nenalezena' });
    if (!(await canSeeSensitive(req.user, person.id))) return res.json(stripSensitive(person));
    // Audit čtení: kdo si otevřel kartu osoby s citlivými údaji (ne vlastní kartu)
    if (!(req.user.person && req.user.person.id === person.id)) {
      _logAuditHr({ action: 'read', entity: 'person', entity_id: person.id, description: 'Zobrazena karta osoby s citlivými údaji: ' + [person.first_name, person.last_name].filter(Boolean).join(' '), user: req.user }).catch(() => {});
    }
    res.json(person);
  } catch (err) {
    next(err);
  }
});

// Sanitizace dat pro Person model — jen povolená pole se správnými typy
// currentUser = req.user (volitelný) — pro kontrolu oprávnění
// opts.mode = 'create' | 'update' (default 'update')
//   V režimu 'update' jsou kritická datumová pole chráněna před samovolným smazáním:
//   prázdná/null hodnota se IGNORUJE (nezmění DB), pokud klient explicitně neuvede
//   pole `__clear_dates: [...]` se seznamem polí ke smazání. Důvod: zabránit ztrátě
//   datumu nástupu při uložení formuláře, kde se datum z nějakého důvodu (omyl,
//   rendering, klávesa Backspace) zobrazí jako prázdné. (Požadavek #57)
function sanitizePersonData(body, currentUser, opts = {}) {
  const mode = opts.mode === 'create' ? 'create' : 'update';
  const data = {};
  // String pole
  const strFields = ['type', 'first_name', 'last_name', 'email', 'phone', 'notes',
    'employee_number', 'contract_type', 'birth_number', 'id_card_number', 'gender',
    'address', 'city', 'zip', 'bank_account', 'emergency_name', 'emergency_phone',
    'emergency_relation', 'photo_url', 'chip_number', 'chip_card_id', 'username'];
  for (const f of strFields) {
    if (f in body) data[f] = body[f] || null;
  }
  // Datum pole — chráněna v update režimu před nechtěným smazáním
  const dateFields = ['hire_date', 'end_date', 'birth_date', 'leave_entitlement_from'];
  const clearList = Array.isArray(body.__clear_dates) ? body.__clear_dates : [];
  for (const f of dateFields) {
    if (!(f in body)) continue;
    const v = body[f];
    if (v) {
      data[f] = new Date(v);
    } else if (mode === 'create' || clearList.includes(f)) {
      // Tvorba osoby: null je legitimní výchozí stav.
      // Update: smazání povoleno pouze pokud klient explicitně potvrdil (__clear_dates).
      data[f] = null;
    }
    // Jinak: pole v update režimu bez hodnoty se ignoruje (ochrana proti přepsání na NULL).
  }
  // Integer FK pole
  const intFields = ['department_id', 'role_id', 'supervisor_id', 'shift_id', 'user_id', 'company_id', 'leave_entitlement_days', 'leave_carryover'];
  for (const f of intFields) {
    if (f in body) data[f] = body[f] ? parseInt(body[f]) : null;
  }
  // Decimal pole
  const decFields = ['hourly_rate', 'monthly_salary'];
  for (const f of decFields) {
    if (f in body) data[f] = body[f] ? parseFloat(body[f]) : null;
  }
  // Boolean pole
  const toBool = v => !!v && v !== 'false' && v !== '0';
  if ('active' in body) data.active = toBool(body.active);
  if ('can_upload_cad' in body) data.can_upload_cad = toBool(body.can_upload_cad);
  if ('is_salesperson' in body) data.is_salesperson = toBool(body.is_salesperson);
  if ('is_sales_lead' in body) data.is_sales_lead = toBool(body.is_sales_lead);
  if ('can_give_discount' in body) data.can_give_discount = toBool(body.can_give_discount);
  if ('can_add_individual_offers' in body) data.can_add_individual_offers = toBool(body.can_add_individual_offers);
  // is_super_admin může měnit jen admin nebo super admin
  const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.isSuperAdmin);
  if ('is_super_admin' in body && isAdmin) {
    data.is_super_admin = toBool(body.is_super_admin);
  }
  return data;
}

// Ruční nastavení typu „bývalý zaměstnanec" bez data konce by rekonciliace
// hned vrátila zpět na 'employee' (rozhoduje se podle end_date), proto se
// v takovém případě doplní dnešní datum konce. (Požadavek #103)
function ensureFormerEndDate(data, before) {
  if (data.type !== 'former') return data;
  const existing = data.end_date !== undefined ? data.end_date : (before ? before.end_date : null);
  if (!existing) {
    const { today } = nowInPrague(); // pražský den, ne lokální půlnoc procesu (Požadavek #134)
    data.end_date = today;
  }
  return data;
}

// Sanitizace dat pro Role (whitelist povolených polí)
function sanitizeRoleData(body) {
  const data = {};
  // String pole
  const strFields = ['name', 'description'];
  for (const f of strFields) {
    if (f in body) data[f] = body[f] || null;
  }
  // Integer FK pole
  const intFields = ['department_id', 'company_id', 'parent_role_id'];
  for (const f of intFields) {
    if (f in body) data[f] = body[f] ? parseInt(body[f]) : null;
  }
  return data;
}

// POST /api/hr/people
router.post('/people', requireHrWrite, async (req, res, next) => {
  try {
    const person = await prisma.person.create({
      data: ensureFormerEndDate(sanitizePersonData(req.body, req.user, { mode: 'create' }), null),
      include: { department: true, role: true, company: true },
    });
    await logAudit({
      action: 'create', entity: 'person', entity_id: person.id,
      description: `Vytvořena osoba: ${person.first_name} ${person.last_name}`,
      snapshot: makeSnapshot(person), user: req.user,
    });
    res.status(201).json(person);
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/people/:id
router.put('/people/:id', requireHrWrite, async (req, res, next) => {
  try {
    const before = await prisma.person.findUnique({ where: { id: parseInt(req.params.id) } });

    // Nárok na dovolenou smí měnit jen role s právem na modul „hr-dovolena"
    // (požadavek #139). Když se pole neposílají nebo se nemění, nic neřešíme.
    const poleDovolene = ['leave_entitlement_days', 'leave_carryover', 'leave_entitlement_from'];
    const meniDovolenou = poleDovolene.some((f) => {
      if (!(f in req.body)) return false;
      const nova = req.body[f];
      const stara = before ? before[f] : null;
      if (f === 'leave_entitlement_from') {
        const a = nova ? new Date(nova).toISOString().slice(0, 10) : null;
        const b = stara ? new Date(stara).toISOString().slice(0, 10) : null;
        return a !== b;
      }
      const a = nova === '' || nova == null ? null : parseInt(nova, 10);
      const b = stara == null ? null : parseInt(stara, 10);
      return a !== b;
    });
    if (meniDovolenou && !(await canEditLeave(req.user))) {
      return res.status(403).json({ error: 'Na úpravu nároku na dovolenou nemáte oprávnění.' });
    }

    const person = await prisma.person.update({
      where: { id: parseInt(req.params.id) },
      data: ensureFormerEndDate(sanitizePersonData(req.body, req.user, { mode: 'update' }), before),
      include: { department: true, role: true, company: true },
    });
    const changes = diffObjects(before, person);
    if (changes) {
      await logAudit({
        action: 'update', entity: 'person', entity_id: person.id,
        description: `Upravena osoba: ${person.first_name} ${person.last_name}`,
        changes, snapshot: makeSnapshot(before), user: req.user,
      });
    }
    res.json(person);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/hr/people/:id (soft delete)
router.delete('/people/:id', requireHrWrite, async (req, res, next) => {
  try {
    const before = await prisma.person.findUnique({ where: { id: parseInt(req.params.id) } });
    await prisma.person.update({
      where: { id: parseInt(req.params.id) },
      data: { active: false },
    });
    await logAudit({
      action: 'delete', entity: 'person', entity_id: parseInt(req.params.id),
      description: `Smazána osoba: ${before ? before.first_name + ' ' + before.last_name : req.params.id}`,
      snapshot: makeSnapshot(before), user: req.user,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── ODDĚLENÍ ──────────────────────────────────────────────────────────────

// GET /api/hr/departments
router.get('/departments', async (req, res, next) => {
  try {
    const departments = await prisma.department.findMany({
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { people: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json(departments);
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/departments
router.post('/departments', async (req, res, next) => {
  try {
    const dept = await prisma.department.create({ data: req.body });
    await logAudit({
      action: 'create', entity: 'department', entity_id: dept.id,
      description: `Vytvořeno oddělení: ${dept.name}`,
      snapshot: makeSnapshot(dept), user: req.user,
    });
    res.status(201).json(dept);
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/departments/:id
router.put('/departments/:id', async (req, res, next) => {
  try {
    const before = await prisma.department.findUnique({ where: { id: parseInt(req.params.id) } });
    const dept = await prisma.department.update({
      where: { id: parseInt(req.params.id) },
      data: req.body,
    });
    const changes = diffObjects(before, dept);
    if (changes) {
      await logAudit({
        action: 'update', entity: 'department', entity_id: dept.id,
        description: `Upraveno oddělení: ${dept.name}`,
        changes, snapshot: makeSnapshot(before), user: req.user,
      });
    }
    res.json(dept);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/hr/departments/:id
router.delete('/departments/:id', async (req, res, next) => {
  try {
    const before = await prisma.department.findUnique({ where: { id: parseInt(req.params.id) } });
    await prisma.department.delete({ where: { id: parseInt(req.params.id) } });
    await logAudit({
      action: 'delete', entity: 'department', entity_id: parseInt(req.params.id),
      description: `Smazáno oddělení: ${before ? before.name : req.params.id}`,
      snapshot: makeSnapshot(before), user: req.user,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── ROLE ──────────────────────────────────────────────────────────────────

// GET /api/hr/roles
router.get('/roles', async (req, res, next) => {
  try {
    const roles = await prisma.role.findMany({
      include: {
        department: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
        _count: { select: { people: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json(roles);
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/roles
router.post('/roles', requireAdmin, async (req, res, next) => {
  try {
    const data = sanitizeRoleData(req.body);
    const role = await prisma.role.create({ data });
    await logAudit({
      action: 'create', entity: 'role', entity_id: role.id,
      description: `Vytvořena role: ${role.name}`,
      snapshot: makeSnapshot(role), user: req.user,
    });
    res.status(201).json(role);
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/roles/:id
router.put('/roles/:id', requireAdmin, async (req, res, next) => {
  try {
    const before = await prisma.role.findUnique({ where: { id: parseInt(req.params.id) } });
    const data = sanitizeRoleData(req.body);
    const role = await prisma.role.update({
      where: { id: parseInt(req.params.id) },
      data,
    });
    const changes = diffObjects(before, role);
    if (changes) {
      await logAudit({
        action: 'update', entity: 'role', entity_id: role.id,
        description: `Upravena role: ${role.name}`,
        changes, snapshot: makeSnapshot(before), user: req.user,
      });
    }
    res.json(role);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/hr/roles/:id
router.delete('/roles/:id', requireAdmin, async (req, res, next) => {
  try {
    const before = await prisma.role.findUnique({ where: { id: parseInt(req.params.id) } });
    await prisma.role.delete({ where: { id: parseInt(req.params.id) } });
    await logAudit({
      action: 'delete', entity: 'role', entity_id: parseInt(req.params.id),
      description: `Smazána role: ${before ? before.name : req.params.id}`,
      snapshot: makeSnapshot(before), user: req.user,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── SMĚNY ───────────────────────────────────────────────────

// Validace dat směny — whitelist povolených polí, aby neznámé pole neshodilo Prismu
const shiftBaseSchema = z.object({
  name: z.string().trim().min(1, 'Název směny je povinný').max(255, 'Název směny je příliš dlouhý'),
  type: z.enum(['fixed', 'flexible']).default('fixed'),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, 'Začátek musí být ve formátu HH:MM').nullable().default(null),
  end_time: z.string().regex(/^\d{2}:\d{2}$/, 'Konec musí být ve formátu HH:MM').nullable().default(null),
  hours_fund: z.coerce.number('Fond hodin musí být číslo').min(0, 'Fond hodin nemůže být negativní').max(24, 'Fond hodin nemůže přesáhnout 24 h').default(8),
  break_minutes: z.coerce.number('Přestávka musí být číslo').int('Přestávka musí být celé číslo').min(0, 'Přestávka nemůže být negativní').max(480, 'Přestávka nemůže přesáhnout 480 min').default(30),
  // Dny v týdnu (ISO: 1 = pondělí … 7 = neděle). null = neurčeno.
  weekdays: z.array(
    z.coerce.number('Den v týdnu musí být číslo').int().min(1, 'Neplatný den v týdnu').max(7, 'Neplatný den v týdnu'),
  ).max(7, 'Dnů v týdnu je nejvýš sedm').nullable().default(null),
});

// U pevné směny musí být vyplněný začátek i konec
const shiftCreateSchema = shiftBaseSchema.refine(
  (d) => d.type !== 'fixed' || (d.start_time && d.end_time),
  { message: 'U pevné směny je nutné zadat začátek i konec', path: ['start_time'] },
);

// Normalizace těla requestu: prázdné stringy → null, pružná směna nemá časy
function normalizeShiftBody(body) {
  const raw = { ...(body || {}) };
  for (const f of ['start_time', 'end_time']) {
    if (raw[f] === '' || raw[f] === undefined) raw[f] = null;
  }
  if (raw.type === 'flexible') {
    raw.start_time = null;
    raw.end_time = null;
  }
  // Dny v týdnu: zahodíme duplicity, seřadíme od pondělí. Prázdný výběr ukládáme
  // jako null — „žádný den nezaškrtnut" a „dny neurčeny" je pro směnu totéž.
  if (Array.isArray(raw.weekdays)) {
    const uniq = Array.from(new Set(raw.weekdays.map((d) => Number(d)).filter((d) => Number.isInteger(d))));
    raw.weekdays = uniq.length ? uniq.sort((a, b) => a - b) : null;
  } else if (raw.weekdays === '' || raw.weekdays === undefined) {
    raw.weekdays = null;
  }
  return raw;
}

// První chybová hláška ze zod — aby uživatel viděl konkrétní důvod
function firstZodMessage(error, fallback) {
  const issue = error.issues && error.issues[0];
  return issue ? issue.message : (fallback || 'Neplatná data');
}

// GET /api/hr/shifts
router.get('/shifts', async (req, res, next) => {
  try {
    const shifts = await prisma.shift.findMany({
      include: { _count: { select: { people: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(shifts);
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/shifts
router.post('/shifts', async (req, res, next) => {
  try {
    const parsed = shiftCreateSchema.safeParse(normalizeShiftBody(req.body));
    if (!parsed.success) {
      return res.status(400).json({ error: firstZodMessage(parsed.error), details: parsed.error.issues });
    }
    const shift = await prisma.shift.create({ data: parsed.data });
    await logAudit({
      action: 'create', entity: 'shift', entity_id: shift.id,
      description: `Vytvořena směna: ${shift.name}`,
      snapshot: makeSnapshot(shift), user: req.user,
    });
    res.status(201).json(shift);
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/shifts/:id
router.put('/shifts/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Neplatné ID směny' });
    }
    const parsed = shiftCreateSchema.safeParse(normalizeShiftBody(req.body));
    if (!parsed.success) {
      return res.status(400).json({ error: firstZodMessage(parsed.error), details: parsed.error.issues });
    }
    const before = await prisma.shift.findUnique({ where: { id } });
    if (!before) {
      return res.status(404).json({ error: 'Směna nenalezena' });
    }
    const shift = await prisma.shift.update({ where: { id }, data: parsed.data });
    const changes = diffObjects(before, shift);
    if (changes) {
      await logAudit({
        action: 'update', entity: 'shift', entity_id: shift.id,
        description: `Upravena směna: ${shift.name}`,
        changes, snapshot: makeSnapshot(before), user: req.user,
      });
    }
    res.json(shift);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/hr/shifts/:id
router.delete('/shifts/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Neplatné ID směny' });
    }
    const before = await prisma.shift.findUnique({ where: { id } });
    await prisma.shift.delete({ where: { id } });
    await logAudit({
      action: 'delete', entity: 'shift', entity_id: id,
      description: `Smazána směna: ${before ? before.name : id}`,
      snapshot: makeSnapshot(before), user: req.user,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── TYPY ABSENCÍ ─────────────────────────────────────────────────────────

// GET /api/hr/absence-types
router.get('/absence-types', async (req, res, next) => {
  try {
    const types = await prisma.absenceType.findMany({ orderBy: { id: 'asc' } });
    res.json(types);
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/absence-types
router.post('/absence-types', async (req, res, next) => {
  try {
    const type = await prisma.absenceType.create({ data: req.body });
    res.status(201).json(type);
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/absence-types/:id
router.put('/absence-types/:id', async (req, res, next) => {
  try {
    const type = await prisma.absenceType.update({
      where: { id: parseInt(req.params.id) },
      data: req.body,
    });
    res.json(type);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/hr/absence-types/:id
router.delete('/absence-types/:id', async (req, res, next) => {
  try {
    await prisma.absenceType.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── DOCHÁZKA ──────────────────────────────────────────────────────────────

// GET /api/hr/attendance?person_id=&date_from=&date_to=&month=YYYY-MM
router.get('/attendance', async (req, res, next) => {
  try {
    const { person_id, date_from, date_to, month } = req.query;

    const where = {};
    if (person_id) where.person_id = parseInt(person_id);

    // Filtr podle měsíce (month=2026-04)
    if (month) {
      const [year, mon] = month.split('-').map(Number);
      const start = new Date(year, mon - 1, 1);
      const end = new Date(year, mon, 0); // poslední den měsíce
      where.date = { gte: start, lte: end };
    } else if (date_from || date_to) {
      where.date = {};
      if (date_from) where.date.gte = new Date(date_from);
      if (date_to) where.date.lte = new Date(date_to);
    }

    const records = await prisma.attendance.findMany({
      where,
      include: {
        person: { select: { id: true, first_name: true, last_name: true } },
      },
      orderBy: [{ date: 'desc' }, { clock_in: 'desc' }],
    });

    // Zploštit person data pro frontend (r.first_name, r.last_name)
    const flat = records.map(r => ({
      ...r,
      first_name: r.person?.first_name || '',
      last_name: r.person?.last_name || '',
    }));

    res.json(flat);
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/attendance (příchod/odchod)
router.post('/attendance', async (req, res, next) => {
  try {
    const record = await prisma.attendance.create({ data: req.body });
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/attendance/:id
router.put('/attendance/:id', async (req, res, next) => {
  try {
    const record = await prisma.attendance.update({
      where: { id: parseInt(req.params.id) },
      data: req.body,
    });
    res.json(record);
  } catch (err) {
    next(err);
  }
});

// ─── ŽÁDOSTI O VOLNO ──────────────────────────────────────────────────────
//
// Požadavek #136: žádost se po odeslání musí objevit v seznamu, schválit ji smí
// přímý nadřízený žádajícího nebo ředitel a po schválení se absence promítne do
// plánování výroby (plánovač nepřítomného nikomu nenabídne).
//
// Dřív se tělo requestu posílalo do Prismy syrové (`data: req.body`) — datum
// z <input type="date"> přišlo jako "2026-11-10", což Prisma u DateTime pole
// odmítne, request skončil 500 a frontend chybu zahodil. Odtud „žádost se
// nikde neobjeví".

const leaveRequestSchema = z.object({
  person_id: z.coerce.number({ error: 'Vyberte zaměstnance' }).int().positive('Vyberte zaměstnance'),
  type: z.string().trim().min(1, 'Vyberte typ volna').max(50, 'Typ volna je příliš dlouhý'),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum „Od" musí být ve tvaru RRRR-MM-DD'),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum „Do" musí být ve tvaru RRRR-MM-DD'),
  // Čas je volitelný; prázdné pole = celodenní volno jako dosud. (Požadavek #141)
  time_from: z.string().regex(/^\d{2}:\d{2}$/, 'Čas „Od" musí být ve tvaru HH:MM').nullish(),
  time_to: z.string().regex(/^\d{2}:\d{2}$/, 'Čas „Do" musí být ve tvaru HH:MM').nullish(),
  note: z.string().trim().max(2000, 'Poznámka je příliš dlouhá').nullish(),
}).refine((d) => d.date_to >= d.date_from, {
  message: 'Datum „Do" nemůže být dřív než „Od"',
  path: ['date_to'],
}).refine(
  // Stejný den → čas „Do" musí být po čase „Od".
  (d) => !(d.date_to === d.date_from && d.time_from && d.time_to) || d.time_to > d.time_from,
  { message: 'Ve stejný den nemůže být čas „Do" dřív než „Od"', path: ['time_to'] },
);

// 'YYYY-MM-DD' → půlnoc v UTC. Pole je Prisma @db.Date, tak se uloží holý den
// bez posunu o časovou zónu (na Windows i na Railway stejně).
function denNaDatum(s) {
  return new Date(`${s}T00:00:00.000Z`);
}

function denCesky(d) {
  return new Date(d).toLocaleDateString('cs-CZ', { timeZone: 'UTC' });
}

// Osoba přihlášeného uživatele včetně pozice — potřeba pro kontrolu, kdo smí schvalovat.
async function prihlasenaOsoba(user) {
  if (!user || !user.person) return null;
  return prisma.person.findUnique({
    where: { id: user.person.id },
    select: { id: true, first_name: true, last_name: true, supervisor_id: true, role: { select: { name: true } } },
  });
}

// Ředitel = osoba, jejíž pozice (Role) má v názvu „ředitel" (bez ohledu na
// diakritiku a velikost písmen — projde „Ředitel", „výrobní ředitelka" i „RETIZEL" ne).
function jeReditel(osoba) {
  const nazev = osoba && osoba.role && osoba.role.name ? osoba.role.name : '';
  return nazev
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .includes('reditel');
}

// Smí přihlášený uživatel rozhodnout o téhle žádosti?
// Povolení má přímý nadřízený žadatele nebo ředitel. (Požadavek #136)
// Ředitel navíc rozhoduje i o svém vlastním volnu — nad ním už nikdo není,
// takže zásada „o vlastní žádosti nerozhoduji" u něj neplatí. (Požadavek #143)
async function overSchvalovatele(user, zadost) {
  const osoba = await prihlasenaOsoba(user);
  if (!osoba) {
    return { ok: false, chyba: 'Váš účet nemá navázanou osobu v HR, nemůžete schvalovat žádosti.' };
  }
  const reditel = jeReditel(osoba);
  if (zadost.person_id === osoba.id && !reditel) {
    return { ok: false, chyba: 'Vlastní žádost o volno si schválit nemůžete — rozhodne nadřízený nebo ředitel.' };
  }
  const nadrizeny = zadost.person && zadost.person.supervisor_id === osoba.id;
  if (nadrizeny || reditel) return { ok: true, osoba };
  return { ok: false, chyba: 'Žádost smí schválit nebo zamítnout jen přímý nadřízený žadatele nebo ředitel.' };
}

// Komu dát vědět o nové žádosti: přímý nadřízený + ředitelé (jejich uživatelské účty).
async function schvalovateleUserIds(zadost) {
  const ids = new Set();
  try {
    const kandidati = await prisma.person.findMany({
      where: {
        active: true,
        user_id: { not: null },
        OR: [
          zadost.person && zadost.person.supervisor_id ? { id: zadost.person.supervisor_id } : { id: -1 },
          { role: { name: { contains: 'editel', mode: 'insensitive' } } },
        ],
      },
      select: { id: true, user_id: true },
    });
    for (const k of kandidati) if (k.user_id && k.id !== zadost.person_id) ids.add(k.user_id);
  } catch (e) {
    console.warn('[hr] schvalovatele žádosti o volno:', e.message);
  }
  return [...ids];
}

function jmenoOsoby(p) {
  if (!p) return 'Neznámý';
  return `${p.last_name || ''} ${p.first_name || ''}`.trim() || ('#' + p.id);
}

// Žádost i s osobou žadatele — potřeba pro kontrolu nadřízeného.
async function nactiZadost(id) {
  return prisma.leaveRequest.findUnique({
    where: { id },
    include: { person: { select: { id: true, first_name: true, last_name: true, supervisor_id: true, user_id: true } } },
  });
}

// Upozornění nadřízenému a ředitelům na novou žádost.
async function notifikujSchvalovatele(request, zamestnanec) {
  try {
    const { createNotification } = require('./notifications.routes');
    const prijemci = await schvalovateleUserIds(request);
    for (const uid of prijemci) {
      await createNotification({
        userId: uid,
        type: 'leave_request',
        title: `📝 Žádost o volno: ${jmenoOsoby(zamestnanec)}`,
        body: `${request.type} · ${denCesky(request.date_from)} – ${denCesky(request.date_to)}${request.note ? '\n' + request.note : ''}`,
        link: '/modules/lide-hr/index.html',
        meta: { leave_request_id: request.id, person_id: request.person_id },
      });
    }
  } catch (e) {
    console.warn('[hr] notifikace o žádosti o volno:', e.message);
  }
}

// Vyrozumění žadatele o výsledku (jen když má uživatelský účet).
async function oznamZadateli(request, osoba, vysledek) {
  try {
    if (!osoba || !osoba.user_id) return;
    const { createNotification } = require('./notifications.routes');
    const schvaleno = vysledek === 'approved';
    await createNotification({
      userId: osoba.user_id,
      type: 'leave_request',
      title: schvaleno ? '✅ Volno schváleno' : '❌ Volno zamítnuto',
      body: `${request.type} · ${denCesky(request.date_from)} – ${denCesky(request.date_to)}`,
      link: '/modules/lide-hr/index.html',
      meta: { leave_request_id: request.id },
    });
  } catch (e) {
    console.warn('[hr] vyrozumění žadatele o volnu:', e.message);
  }
}

/**
 * Promítnutí schválené absence do plánování výroby. (Požadavek #136)
 *
 * Dopředu to řeší plánovač sám — services/planning/absence.js načítá schválené
 * žádosti a scheduler i Mistr dispečer nepřítomného přeskočí. Tady dořešíme
 * situaci, kdy je volno schválené až na týden, který je UŽ rozplánovaný:
 * plán nepřepisujeme (to by rozhodilo termíny), ale najdeme kolizní operace
 * a pošleme je nadřízenému a ředitelům k přeobsazení.
 */
async function resiPlanPoSchvaleni(request) {
  try {
    const { findPlannedConflicts } = require('../services/planning/absence');
    const kolize = await findPlannedConflicts(prisma, request);
    if (!kolize.length) return [];

    const jmeno = jmenoOsoby(request.person);
    const seznam = kolize.slice(0, 10)
      .map(k => `• ${k.batch_number} — ${k.name} (${new Date(k.planned_start).toLocaleString('cs-CZ')})`)
      .join('\n');
    const vic = kolize.length > 10 ? `\n…a dalších ${kolize.length - 10}` : '';

    const { createNotification } = require('./notifications.routes');
    const prijemci = await schvalovateleUserIds(request);
    for (const uid of prijemci) {
      await createNotification({
        userId: uid,
        type: 'task_status',
        title: `⚠️ ${jmeno} má volno na ${kolize.length} naplánovaných operací`,
        body: `Schválené volno ${denCesky(request.date_from)} – ${denCesky(request.date_to)} se kryje s už naplánovanou prací:\n${seznam}${vic}\n\nOperace je potřeba přeobsadit.`,
        link: '/modules/planovani-vyroby',
        meta: { leave_request_id: request.id, person_id: request.person_id, operation_ids: kolize.map(k => k.operation_id) },
      });
    }
    return kolize;
  } catch (e) {
    console.warn('[hr] kontrola plánu po schválení volna:', e.message);
    return [];
  }
}

// GET /api/hr/leave-requests
router.get('/leave-requests', async (req, res, next) => {
  try {
    const { person_id, status } = req.query;
    const where = {};
    if (person_id) where.person_id = parseInt(person_id);
    if (status) where.status = status;

    const requests = await prisma.leaveRequest.findMany({
      where,
      include: {
        person: { select: { id: true, first_name: true, last_name: true, supervisor_id: true } },
        approver: { select: { id: true, first_name: true, last_name: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    // can_approve = smí o žádosti rozhodnout přihlášený uživatel? Frontend podle
    // toho ukáže nebo schová tlačítka, aby lidé neklikali na něco, co jim server
    // stejně odmítne. (Požadavek #136)
    const osoba = await prihlasenaOsoba(req.user);
    const reditel = jeReditel(osoba);
    const smiRozhodnout = (r) => {
      if (!osoba || r.status !== 'pending') return false;
      // Vlastní žádost: tlačítka uvidí jedině ředitel. (Požadavek #143)
      if (r.person_id === osoba.id) return reditel;
      return reditel || (r.person && r.person.supervisor_id === osoba.id);
    };

    res.json(requests.map(r => ({ ...r, can_approve: smiRozhodnout(r) })));
  } catch (err) {
    next(err);
  }
});

// ─── Propis schválené dovolené do docházky ────────────────────────────────
// Schválená žádost se propíše do docházky zaměstnance (pracovní dny po–pá).
// Vygenerované záznamy poznáme podle markeru `[DOV#<id>]` v poznámce, takže
// při zamítnutí nebo změně termínu je umíme zase uklidit.
const LEAVE_REQ_TAG = (id) => `[DOV#${id}]`;
// Typ žádosti → typ docházky (v docházce rozlišujeme práci, dovolenou a nemoc).
function attendanceTypeForLeave(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'sick' || t === 'nemoc') return 'sick';
  if (t === 'vacation' || t === 'dovolena' || t === 'dovolená') return 'vacation';
  return 'other';
}

async function clearLeaveRequestAttendance(requestId) {
  try {
    await prisma.attendance.deleteMany({ where: { note: { startsWith: LEAVE_REQ_TAG(requestId) } } });
  } catch (e) {
    console.warn('[hr] úklid docházky dovolené:', e.message);
  }
}

// Zapíše schválenou dovolenou do docházky. Den s už zapsaným příchodem
// nepřepisujeme — reálně odpracovaný den má přednost.
async function syncLeaveRequestToAttendance(request) {
  if (!request || request.status !== 'approved') return 0;
  const from = parseDateOnly(request.date_from);
  const to = parseDateOnly(request.date_to);
  if (!from || !to) return 0;
  const days = workdaysBetween(from, to);
  if (!days.length) return 0;

  const typ = attendanceTypeForLeave(request.type);
  const note = `${LEAVE_REQ_TAG(request.id)} Schválená dovolená`;
  const existing = await prisma.attendance.findMany({
    where: { person_id: request.person_id, date: { in: days } },
    select: { id: true, date: true, clock_in: true },
  });
  const obsazeno = new Map(existing.map((a) => [new Date(a.date).toISOString().slice(0, 10), a]));

  const toCreate = [];
  const toUpdate = [];
  for (const d of days) {
    const found = obsazeno.get(d.toISOString().slice(0, 10));
    if (!found) { toCreate.push({ person_id: request.person_id, date: d, type: typ, note }); continue; }
    if (found.clock_in) continue;
    toUpdate.push(found.id);
  }
  if (toCreate.length) await prisma.attendance.createMany({ data: toCreate, skipDuplicates: true });
  if (toUpdate.length) {
    await prisma.attendance.updateMany({ where: { id: { in: toUpdate } }, data: { type: typ, note } });
  }
  return toCreate.length + toUpdate.length;
}

// POST /api/hr/leave-requests
//
// Dřív se tělo requestu posílalo do Prismy syrové (`data: req.body`). Datum
// z <input type="date"> přijde jako "2026-11-10", což Prisma u DateTime pole
// odmítne — request skončil chybou, frontend ji zahodil a žádost se „nikde
// neobjevila". Teď se tělo validuje zodem a datumy převedou na Date.
// (Požadavek #136)
router.post('/leave-requests', async (req, res, next) => {
  try {
    const parsed = leaveRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: firstZodMessage(parsed.error, 'Neplatná data žádosti o volno'), details: parsed.error.issues });
    }
    const d = parsed.data;

    const zamestnanec = await prisma.person.findUnique({
      where: { id: d.person_id },
      select: { id: true, first_name: true, last_name: true, supervisor_id: true },
    });
    if (!zamestnanec) return res.status(400).json({ error: 'Zaměstnanec neexistuje' });

    const request = await prisma.leaveRequest.create({
      data: {
        person_id: d.person_id,
        type: d.type,
        date_from: denNaDatum(d.date_from),
        date_to: denNaDatum(d.date_to),
        time_from: d.time_from || null,
        time_to: d.time_to || null,
        note: d.note || null,
        status: 'pending',
      },
      include: { person: { select: { id: true, first_name: true, last_name: true, supervisor_id: true } } },
    });

    await logAudit({
      action: 'create', entity: 'leave_request', entity_id: request.id,
      description: `Nová žádost o volno: ${jmenoOsoby(zamestnanec)} ${denCesky(request.date_from)}–${denCesky(request.date_to)}`,
      snapshot: makeSnapshot(request), user: req.user,
    });

    // Nadřízený a ředitelé se o žádosti dozví hned, ať na ni nikdo nečeká.
    await notifikujSchvalovatele(request, zamestnanec);

    res.status(201).json(request);
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/leave-requests/:id — úprava žádosti (poznámka, typ, termín).
// O stavu se rozhoduje jen přes /approve a /reject, kde se kontroluje
// oprávnění schvalovatele. (Požadavek #136)
router.put('/leave-requests/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID žádosti' });
    if ('status' in req.body) {
      return res.status(400).json({ error: 'Stav žádosti se mění přes schválení nebo zamítnutí.' });
    }

    const zadost = await nactiZadost(id);
    if (!zadost) return res.status(404).json({ error: 'Žádost nenalezena' });

    // Upravovat smí žadatel (dokud žádost čeká) nebo ten, kdo o ní rozhoduje.
    // Bez téhle kontroly by si šlo schválit jeden den a pak si termín přepsat
    // na měsíc — schvalování by nic neznamenalo.
    const osoba = await prihlasenaOsoba(req.user);
    const vlastni = !!(osoba && zadost.person_id === osoba.id);
    if (!(vlastni || (await overSchvalovatele(req.user, zadost)).ok)) {
      return res.status(403).json({ error: 'Upravit žádost smí jen žadatel, jeho nadřízený nebo ředitel.' });
    }
    if (zadost.status !== 'pending') {
      return res.status(409).json({ error: 'O žádosti už bylo rozhodnuto — upravit ji nelze.' });
    }

    const data = {};
    if ('note' in req.body) data.note = req.body.note || null;
    if ('type' in req.body) {
      const typ = String(req.body.type || '').trim().slice(0, 50);
      if (!typ) return res.status(400).json({ error: 'Vyberte typ volna' });
      data.type = typ;
    }
    for (const f of ['date_from', 'date_to']) {
      if (!(f in req.body)) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.body[f] || ''))) {
        return res.status(400).json({ error: 'Datum musí být ve tvaru RRRR-MM-DD' });
      }
      data[f] = denNaDatum(req.body[f]);
    }
    if (!Object.keys(data).length) return res.status(400).json({ error: 'Není co měnit' });
    const od = data.date_from || zadost.date_from;
    const doData = data.date_to || zadost.date_to;
    if (new Date(doData) < new Date(od)) {
      return res.status(400).json({ error: 'Datum „Do" nemůže být dřív než „Od"' });
    }

    const request = await prisma.leaveRequest.update({
      where: { id },
      data,
    });
    // Stav nebo termín se mohl změnit → docházku přegenerujeme načisto.
    try {
      await clearLeaveRequestAttendance(request.id);
      await syncLeaveRequestToAttendance(request);
    } catch (e) { console.warn('[hr] propis dovolené do docházky:', e.message); }
    res.json(request);
  } catch (err) {
    next(err);
  }
});

// ─── DOCHÁZKA — DELETE ─────────────────────────────────────────────────────

// DELETE /api/hr/attendance/:id
router.delete('/attendance/:id', async (req, res, next) => {
  try {
    await prisma.attendance.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── PŘÍTOMNOST (kdo je právě v práci) ────────────────────────────────────

// GET /api/hr/presence
router.get('/presence', async (req, res, next) => {
  try {
    // Pražský kalendářní den, ne lokální půlnoc procesu — viz /stats. (Požadavek #134)
    const { today } = nowInPrague();

    const records = await prisma.attendance.findMany({
      where: {
        date: today,
        clock_in: { not: null },
      },
      include: {
        person: {
          select: {
            id: true, first_name: true, last_name: true,
            department: { select: { id: true, name: true } },
            shift: true,
            photo_url: true,
          },
        },
      },
      orderBy: { clock_in: 'asc' },
    });

    res.json(records);
  } catch (err) {
    next(err);
  }
});

// ─── SCHVÁLENÍ / ZAMÍTNUTÍ DOVOLENÉ ───────────────────────────────────────

// PUT /api/hr/leave-requests/:id/approve
// Schválit smí přímý nadřízený žadatele nebo ředitel. Schvalovatel se bere
// z přihlášení, ne z těla requestu (dřív tam chodil string 'admin', který se
// do číselného pole approved_by nevešel a zápis selhal). (Požadavek #136)
router.put('/leave-requests/:id/approve', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID žádosti' });

    const zadost = await nactiZadost(id);
    if (!zadost) return res.status(404).json({ error: 'Žádost nenalezena' });
    if (zadost.status !== 'pending') {
      return res.status(409).json({ error: zadost.status === 'approved' ? 'Žádost už je schválená.' : 'Žádost už byla zamítnuta.' });
    }

    const opravneni = await overSchvalovatele(req.user, zadost);
    if (!opravneni.ok) return res.status(403).json({ error: opravneni.chyba });

    const request = await prisma.leaveRequest.update({
      where: { id },
      data: { status: 'approved', approved_by: opravneni.osoba.id },
      include: { person: { select: { id: true, first_name: true, last_name: true, supervisor_id: true } } },
    });

    await logAudit({
      action: 'update', entity: 'leave_request', entity_id: request.id,
      description: `Schváleno volno: ${jmenoOsoby(zadost.person)} ${denCesky(request.date_from)}–${denCesky(request.date_to)} (schválil ${jmenoOsoby(opravneni.osoba)})`,
      changes: { status: { from: zadost.status, to: 'approved' } },
      snapshot: makeSnapshot(zadost), user: req.user,
    });

    // Schválená dovolená se propíše zaměstnanci do docházky.
    let attendance_days = 0;
    try {
      await clearLeaveRequestAttendance(request.id);
      attendance_days = await syncLeaveRequestToAttendance(request);
    } catch (e) { console.warn('[hr] propis schválené dovolené do docházky:', e.message); }

    // …a do plánování výroby: plánovač od teď nepřítomného nikomu nenabídne
    // (services/planning/absence.js). Operace, které už na ty dny naplánované
    // jsou, se nepřepisují — jen se na ně upozorní nadřízený a ředitelé.
    const plan_conflicts = await resiPlanPoSchvaleni(request);

    await oznamZadateli(request, zadost.person, 'approved');
    res.json({ ...request, attendance_days, plan_conflicts });
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/leave-requests/:id/reject — stejné oprávnění jako schválení.
router.put('/leave-requests/:id/reject', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Neplatné ID žádosti' });

    const zadost = await nactiZadost(id);
    if (!zadost) return res.status(404).json({ error: 'Žádost nenalezena' });
    // O žádosti se rozhoduje jen jednou — jinak by šlo zamítnout už schválené
    // volno, smazat k němu docházku a nechat plán výroby v rozporu.
    if (zadost.status !== 'pending') {
      return res.status(409).json({ error: zadost.status === 'approved' ? 'Žádost už je schválená.' : 'Žádost už byla zamítnuta.' });
    }

    const opravneni = await overSchvalovatele(req.user, zadost);
    if (!opravneni.ok) return res.status(403).json({ error: opravneni.chyba });

    const request = await prisma.leaveRequest.update({
      where: { id },
      data: { status: 'rejected', approved_by: opravneni.osoba.id },
    });

    await logAudit({
      action: 'update', entity: 'leave_request', entity_id: request.id,
      description: `Zamítnuto volno: ${jmenoOsoby(zadost.person)} ${denCesky(request.date_from)}–${denCesky(request.date_to)} (zamítl ${jmenoOsoby(opravneni.osoba)})`,
      changes: { status: { from: zadost.status, to: 'rejected' } },
      snapshot: makeSnapshot(zadost), user: req.user,
    });

    // Zamítnutá dovolená nemá v docházce co dělat.
    try { await clearLeaveRequestAttendance(request.id); }
    catch (e) { console.warn('[hr] úklid docházky po zamítnutí:', e.message); }

    await oznamZadateli(request, zadost.person, 'rejected');
    res.json(request);
  } catch (err) {
    next(err);
  }
});

// ─── ZŮSTATKY DOVOLENÉ ────────────────────────────────────────────────────

// GET /api/hr/leave-balances
router.get('/leave-balances', async (req, res, next) => {
  try {
    // Rok z filtru nad tabulkou; bez něj aktuální (dřív se query ignorovala).
    const rok = parseInt(req.query.year, 10) || new Date().getFullYear();
    const zacatekRoku = new Date(Date.UTC(rok, 0, 1));
    const konecRoku = new Date(Date.UTC(rok, 11, 31, 23, 59, 59, 999));

    // Dny v UTC, ať se do počtu nepromítne letní čas.
    const DEN = 24 * 60 * 60 * 1000;
    const denCislo = (d) => {
      const x = new Date(d);
      return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()) / DEN;
    };
    // Počet dní úseku oříznutého na vybraný rok (včetně obou krajních dnů).
    const dnuVRoce = (od, doData) => {
      const a = Math.max(denCislo(od), denCislo(zacatekRoku));
      const b = Math.min(denCislo(doData), denCislo(konecRoku));
      return b >= a ? b - a + 1 : 0;
    };

    const people = await prisma.person.findMany({
      where: { active: true, type: 'employee' },
      orderBy: [{ last_name: 'asc' }, { first_name: 'asc' }],
      select: {
        id: true, first_name: true, last_name: true,
        leave_entitlement_days: true, leave_carryover: true, leave_entitlement_from: true,
        leave_requests: {
          where: {
            status: 'approved',
            date_from: { lte: konecRoku },
            date_to: { gte: zacatekRoku },
          },
        },
      },
    });

    // Celozávodní dovolená zasahující do vybraného roku. Je to jen INFORMATIVNÍ
    // sloupec — kryje se z běžného nároku, takže se do „čerpané" nepřičítá.
    const celozavodni = await prisma.companyLeave.findMany({
      where: { date_from: { lte: konecRoku }, date_to: { gte: zacatekRoku } },
      select: { date_from: true, date_to: true, excluded_person_ids: true },
    });
    // excluded_person_ids je Json — může přijít jako pole, string i null.
    const vyjimky = celozavodni.map((cl) => {
      let ids = cl.excluded_person_ids;
      if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch (_) { ids = []; } }
      const set = new Set((Array.isArray(ids) ? ids : []).map((x) => parseInt(x, 10)));
      return { dny: dnuVRoce(cl.date_from, cl.date_to), vynechani: set };
    });

    // Ručně přepsané dny celozávodní dovolené pro tenhle rok (požadavek #142).
    // Kde záznam není, platí dál spočtená hodnota.
    const rucni = new Map();
    try {
      const rows = await prisma.companyLeaveOverride.findMany({
        where: { year: rok, person_id: { in: people.map((p) => p.id) } },
        select: { person_id: true, days: true },
      });
      for (const r of rows) rucni.set(r.person_id, r.days);
    } catch (e) {
      // Chybějící tabulka (nenasazená migrace) nesmí shodit celý přehled.
      console.warn('[hr] ruční celozávodní dovolená:', e.message);
    }

    const balances = people.map(p => {
      const entitlement = p.leave_entitlement_days || 20;
      const carryover = p.leave_carryover || 0;
      let usedDays = 0;
      for (const lr of p.leave_requests) {
        usedDays += dnuVRoce(lr.date_from, lr.date_to);
      }
      // Dny celozávodní dovolené, které na tohoto člověka dopadají.
      let companyLeaveDays = 0;
      for (const cl of vyjimky) {
        if (!cl.vynechani.has(p.id)) companyLeaveDays += cl.dny;
      }
      // Ruční hodnota má přednost před spočtenou; spočtenou posíláme taky,
      // ať se jde v UI vrátit zpátky k automatice. (Požadavek #142)
      const prepsano = rucni.has(p.id);
      const companyLeaveShown = prepsano ? rucni.get(p.id) : companyLeaveDays;
      return {
        person_id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        // Tabulka v modulu čte person_name — dřív ho route neposílala a svítilo „undefined".
        person_name: `${p.last_name || ''} ${p.first_name || ''}`.trim(),
        entitlement: entitlement,
        carryover: carryover,
        total: entitlement + carryover,
        used: usedDays,
        entitlement_from: p.leave_entitlement_from,
        company_leave_days: companyLeaveShown,
        company_leave_computed: companyLeaveDays,
        company_leave_manual: prepsano,
        remaining: entitlement + carryover - usedDays,
      };
    });

    res.json(balances);
  } catch (err) {
    next(err);
  }
});

// ─── CELOZÁVODNÍ DOVOLENÁ — RUČNÍ HODNOTA U ZAMĚSTNANCE (požadavek #142) ──
// Sloupec „Celozávodní" v přehledu dovolených se normálně počítá z CompanyLeave.
// Role s právem na modul „hr-celozavodni" ho smí u konkrétního člověka a roku
// přepsat; prázdná hodnota přepis zruší a číslo se zase počítá automaticky.

const companyLeaveOverrideSchema = z.object({
  person_id: z.coerce.number({ error: 'Chybí zaměstnanec' }).int().positive('Chybí zaměstnanec'),
  year: z.coerce.number({ error: 'Chybí rok' }).int().min(2000, 'Neplatný rok').max(2100, 'Neplatný rok'),
  // Prázdné pole = zrušit ruční hodnotu. Bez preprocessu by z.coerce udělalo z null nulu.
  days: z.preprocess(
    (v) => (v === '' || v == null ? null : v),
    z.coerce.number({ error: 'Počet dní musí být číslo' }).int('Počet dní musí být celé číslo')
      .min(0, 'Počet dní nemůže být záporný').max(366, 'Počet dní je příliš velký').nullable(),
  ),
});

// GET /api/hr/company-leave-days/can-edit — frontend podle toho povolí editaci buňky.
router.get('/company-leave-days/can-edit', async (req, res, next) => {
  try {
    res.json({ can_edit: await canEditCompanyLeave(req.user) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/company-leave-days { person_id, year, days }
router.put('/company-leave-days', requireCompanyLeaveEdit, async (req, res, next) => {
  try {
    const parsed = companyLeaveOverrideSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: firstZodMessage(parsed.error, 'Neplatná data'), details: parsed.error.issues });
    }
    const { person_id, year, days } = parsed.data;

    const osoba = await prisma.person.findUnique({
      where: { id: person_id },
      select: { id: true, first_name: true, last_name: true },
    });
    if (!osoba) return res.status(400).json({ error: 'Zaměstnanec neexistuje' });

    if (days == null) {
      await prisma.companyLeaveOverride.deleteMany({ where: { person_id, year } });
      await logAudit({
        action: 'delete', entity: 'company_leave_override', entity_id: person_id,
        description: `Zrušena ruční celozávodní dovolená: ${jmenoOsoby(osoba)} (${year}) — počítá se zase automaticky`,
        user: req.user,
      });
      return res.json({ ok: true, person_id, year, days: null, manual: false });
    }

    const zaznam = await prisma.companyLeaveOverride.upsert({
      where: { person_id_year: { person_id, year } },
      create: { person_id, year, days, updated_by: (req.user && req.user.id) || null },
      update: { days, updated_by: (req.user && req.user.id) || null },
    });
    await logAudit({
      action: 'update', entity: 'company_leave_override', entity_id: zaznam.id,
      description: `Celozávodní dovolená ručně: ${jmenoOsoby(osoba)} (${year}) = ${days} dní`,
      snapshot: makeSnapshot(zaznam), user: req.user,
    });
    res.json({ ok: true, person_id, year, days: zaznam.days, manual: true });
  } catch (err) {
    next(err);
  }
});

// ─── NASTAVENÍ DOVOLENÉ ───────────────────────────────────────────────────

// GET /api/hr/leave-settings
router.get('/leave-settings', async (req, res, next) => {
  try {
    let settings = await prisma.leaveSettings.findFirst();
    if (!settings) {
      settings = await prisma.leaveSettings.create({
        data: { id: 1, default_entitlement_days: 20, year: new Date().getFullYear() },
      });
    }
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/leave-settings
// Uloží nastavení a — pokud už je zadané datum dosažené — rovnou přepočítá
// nárok všem zaměstnancům. Datum v budoucnu počká na worker.
router.post('/leave-settings', requireLeaveEdit, async (req, res, next) => {
  try {
    const schema = z.object({
      default_entitlement_days: z.coerce.number().int().min(0).max(366),
      effective_from: z.string().min(8, 'Zadej datum, od kterého má nastavení platit.'),
      carryover_allowed: z.coerce.boolean(),
      carryover_max_days: z.coerce.number().int().min(0).max(366),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(' ') });
    }
    const d = new Date(parsed.data.effective_from);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'Datum platnosti není platné.' });
    const ucinnost = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

    const data = {
      default_entitlement_days: parsed.data.default_entitlement_days,
      carryover_allowed: parsed.data.carryover_allowed,
      carryover_max_days: parsed.data.carryover_max_days,
      effective_from: ucinnost,
    };
    // Změna data = přepočet pro nové datum ještě neproběhl.
    const puvodni = await prisma.leaveSettings.findFirst({ where: { id: 1 } });
    const jineDatum = !puvodni || !puvodni.effective_from
      || new Date(puvodni.effective_from).getTime() !== ucinnost.getTime();
    if (jineDatum) data.last_applied_from = null;

    const settings = await prisma.leaveSettings.upsert({
      where: { id: 1 },
      update: data,
      create: { id: 1, ...data },
    });

    // Datum už nastalo → přepočítáme hned, ať to uživatel vidí.
    let prepocet = null;
    try {
      prepocet = await require('../services/hr/leave-rollover').spustPokudJeCas();
    } catch (e) {
      console.warn('[hr] přepočet nároku selhal:', e.message);
      return res.status(500).json({ error: 'Nastavení uloženo, ale přepočet selhal: ' + e.message });
    }

    await logAudit({
      action: 'update', entity: 'leave_settings', entity_id: 1,
      description: 'Změna nastavení dovolených, platnost od ' + ucinnost.toISOString().slice(0, 10)
        + (prepocet ? ` (přepočteno ${prepocet.pocet} zaměstnanců)` : ' (přepočet proběhne k datu)'),
      user: req.user,
    });

    res.json({ ...settings, prepocet });
  } catch (err) {
    next(err);
  }
});

// GET /api/hr/leave-settings/can-edit — smí přihlášený upravovat nárok?
// Frontend podle toho zamkne pole v kartě zaměstnance i v nastavení.
router.get('/leave-settings/can-edit', async (req, res, next) => {
  try {
    res.json({ can_edit: await canEditLeave(req.user) });
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/leave-settings/apply — ruční spuštění přepočtu (např. po opravě dat)
router.post('/leave-settings/apply', requireLeaveEdit, async (req, res, next) => {
  try {
    const settings = await prisma.leaveSettings.findFirst({ where: { id: 1 } });
    if (!settings || !settings.effective_from) {
      return res.status(400).json({ error: 'Nejdřív nastav datum platnosti.' });
    }
    const rollover = require('../services/hr/leave-rollover');
    const r = await rollover.prepocitej(settings.effective_from, settings);
    await logAudit({
      action: 'update', entity: 'leave_settings', entity_id: 1,
      description: `Ruční přepočet nároku na dovolenou — ${r.pocet} zaměstnanců`,
      user: req.user,
    });
    res.json(r);
  } catch (err) {
    next(err);
  }
});

// ─── PŘESČASY ─────────────────────────────────────────────────────────────

// GET /api/hr/overtime-all?year=2026[&month=11]
// Přehled přesčasů pro tabulku v modulu Lidé a HR → Docházka → Přesčasy.
// POZOR na tvar odpovědi: tabulka čte person_name / total_worked_mins /
// total_fund_mins / overtime_mins / overtime_year_total_mins. Dřív route
// posílala first_name+overtime_hours, takže svítilo „undefined" a „NaN".
// (Požadavek #144)
//
// Odpracováno se bere z časů UPRAVENÝCH vedoucím (adjusted_*), a když nejsou,
// z čipových — stejně jako souhrn na záložce Docházka, ať se přehledy neliší.
// Fond = pracovní dny období (Po–Pá mimo české státní svátky) × denní fond směny.
router.get('/overtime-all', async (req, res, next) => {
  try {
    const targetYear = parseInt(req.query.year, 10) || nowInPrague().year;
    const monthRaw = req.query.month ? parseInt(req.query.month, 10) : null;
    const month = monthRaw >= 1 && monthRaw <= 12 ? monthRaw : null;

    // Období pro tabulku: buď zvolený měsíc, nebo celý rok.
    // Prisma @db.Date → hranice jako UTC půlnoc, ne lokální čas procesu.
    const periodStart = new Date(Date.UTC(targetYear, month ? month - 1 : 0, 1));
    const periodEnd = new Date(Date.UTC(targetYear, month ? month : 12, 0));
    const yearStart = new Date(Date.UTC(targetYear, 0, 1));
    const yearEnd = new Date(Date.UTC(targetYear, 12, 0));

    const people = await prisma.person.findMany({
      where: { active: true, type: 'employee' },
      select: {
        id: true, first_name: true, last_name: true,
        shift: { select: { hours_fund: true } },
        attendance: {
          where: { date: { gte: yearStart, lte: yearEnd }, type: 'work' },
          select: {
            date: true, clock_in: true, clock_out: true, break_minutes: true,
            adjusted_clock_in: true, adjusted_clock_out: true, adjusted_break: true,
          },
        },
      },
      orderBy: [{ last_name: 'asc' }, { first_name: 'asc' }],
    });

    // Pracovní dny v období — spočítat jednou, je to pro všechny stejné
    const periodWorkingDays = month
      ? workingDaysInMonth(targetYear, month)
      : workingDaysInYear(targetYear);

    const overtimeData = [];
    for (const p of people) {
      const dailyFundMins = Math.round((p.shift ? parseFloat(p.shift.hours_fund) : 8) * 60);

      let periodWorked = 0;
      let periodDays = 0;
      const byMonth = new Map(); // měsíc (1-12) → odpracované minuty
      for (const a of p.attendance) {
        const mins = workedMinutesOf(a);
        const d = a.date;
        const mo = d.getUTCMonth() + 1;
        byMonth.set(mo, (byMonth.get(mo) || 0) + mins);
        if (d >= periodStart && d <= periodEnd) {
          periodWorked += mins;
          periodDays++;
        }
      }

      // Zaměstnance bez jediného záznamu v období nemá smysl v tabulce ukazovat —
      // vyšel by mu celý fond jako mínus.
      if (periodDays === 0) continue;

      const periodFund = periodWorkingDays * dailyFundMins;

      // Roční přesčas pro limit dle zákoníku práce = součet KLADNÝCH měsíčních
      // přesčasů. Manko z jednoho měsíce nesmí umazat přesčas z jiného — zákon
      // počítá odpracované přesčasové hodiny, ne saldo.
      let yearOvertime = 0;
      for (const [mo, worked] of byMonth) {
        const fund = workingDaysInMonth(targetYear, mo) * dailyFundMins;
        yearOvertime += Math.max(0, worked - fund);
      }

      overtimeData.push({
        person_id: p.id,
        person_name: `${p.last_name || ''} ${p.first_name || ''}`.trim() || ('#' + p.id),
        year: targetYear,
        month: month,
        days_worked: periodDays,
        total_worked_mins: Math.round(periodWorked),
        total_fund_mins: periodFund,
        overtime_mins: Math.round(periodWorked - periodFund),
        overtime_year_total_mins: Math.round(yearOvertime),
      });
    }

    res.json(overtimeData);
  } catch (err) {
    next(err);
  }
});

// GET /api/hr/overtime-settings
router.get('/overtime-settings', async (req, res, next) => {
  try {
    let settings = await prisma.overtimeSettings.findFirst();
    if (!settings) {
      settings = await prisma.overtimeSettings.create({ data: { id: 1 } });
    }
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/overtime-settings
router.post('/overtime-settings', async (req, res, next) => {
  try {
    const settings = await prisma.overtimeSettings.upsert({
      where: { id: 1 },
      update: req.body,
      create: { id: 1, ...req.body },
    });
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// ─── CELOZÁVODNÍ DOVOLENÁ ─────────────────────────────────────────────────
// Celozávodní dovolená platí pro všechny aktivní zaměstnance kromě výjimek.
// Kromě záznamu v tabulce se propíše i do DOCHÁZKY — na každý pracovní den
// (po–pá) vznikne záznam typu 'vacation'. Vygenerované záznamy poznáme podle
// poznámky s markerem `[CZD#<id>]`, takže je umíme při změně i smazání uklidit.

// Datum z formuláře („2026-12-28") → DateTime pro Prisma (@db.Date = půlnoc UTC).
// Prisma holý „YYYY-MM-DD" nepřijme a vyhodí validační chybu — proto převod.
function parseDateOnly(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const m = String(v || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

// Seznam pracovních dnů (po–pá) v rozsahu od–do, jako UTC půlnoci.
function workdaysBetween(from, to) {
  const out = [];
  const d = new Date(from.getTime());
  while (d.getTime() <= to.getTime()) {
    const dow = d.getUTCDay(); // 0 = neděle, 6 = sobota
    if (dow !== 0 && dow !== 6) out.push(new Date(d.getTime()));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const COMPANY_LEAVE_TAG = (id) => `[CZD#${id}]`;

const companyLeaveSchema = z.object({
  name: z.string().trim().min(1, 'Vyplň název celozávodní dovolené.').max(255),
  date_from: z.union([z.string(), z.date()]),
  date_to: z.union([z.string(), z.date()]),
  excluded_person_ids: z.array(z.coerce.number().int()).nullable().optional(),
});

// Připraví data pro Prisma + ohlídá, že „do" není dřív než „od".
function parseCompanyLeaveBody(body) {
  const b = body || {};
  // Rychlá kontrola povinných polí, ať uživatel dostane českou hlášku.
  if (!String(b.name || '').trim()) return { error: 'Vyplň název celozávodní dovolené.' };
  if (!b.date_from || !b.date_to) return { error: 'Vyplň datum od a do.' };
  const parsed = companyLeaveSchema.safeParse(b);
  if (!parsed.success) {
    const issue = parsed.error.issues && parsed.error.issues[0];
    return { error: (issue && issue.message) || 'Neplatná data celozávodní dovolené.' };
  }
  const from = parseDateOnly(parsed.data.date_from);
  const to = parseDateOnly(parsed.data.date_to);
  if (!from || !to) return { error: 'Zadej platné datum od a do (formát RRRR-MM-DD).' };
  if (to.getTime() < from.getTime()) return { error: 'Datum „do" nemůže být dřív než „od".' };
  return {
    data: {
      name: parsed.data.name,
      date_from: from,
      date_to: to,
      excluded_person_ids: parsed.data.excluded_person_ids || [],
    },
  };
}

// Smaže docházkové záznamy vygenerované danou celozávodní dovolenou.
async function clearCompanyLeaveAttendance(leaveId) {
  try {
    await prisma.attendance.deleteMany({ where: { note: { startsWith: COMPANY_LEAVE_TAG(leaveId) } } });
  } catch (e) {
    console.warn('[hr] úklid docházky celozávodní dovolené:', e.message);
  }
}

// Propíše celozávodní dovolenou do docházky všech aktivních zaměstnanců
// (kromě výjimek). Den, kdy už má člověk zapsaný příchod, se nepřepisuje —
// reálně odpracovaný den má přednost. Vrací počet založených záznamů.
async function syncCompanyLeaveToAttendance(leave) {
  const excluded = Array.isArray(leave.excluded_person_ids) ? leave.excluded_person_ids.map(Number) : [];
  const people = await prisma.person.findMany({
    where: { active: true, type: 'employee', ...(excluded.length ? { id: { notIn: excluded } } : {}) },
    select: { id: true },
  });
  if (!people.length) return 0;
  const days = workdaysBetween(leave.date_from, leave.date_to);
  if (!days.length) return 0;

  const note = `${COMPANY_LEAVE_TAG(leave.id)} Celozávodní dovolená: ${leave.name}`;
  // Co už v těch dnech v docházce je — ať nepřepisujeme odpracované dny.
  const existing = await prisma.attendance.findMany({
    where: { person_id: { in: people.map((p) => p.id) }, date: { in: days } },
    select: { id: true, person_id: true, date: true, clock_in: true, note: true },
  });
  const key = (pid, date) => `${pid}|${new Date(date).toISOString().slice(0, 10)}`;
  const byKey = new Map(existing.map((a) => [key(a.person_id, a.date), a]));

  const toCreate = [];
  const toUpdate = [];
  for (const p of people) {
    for (const d of days) {
      const found = byKey.get(key(p.id, d));
      if (!found) { toCreate.push({ person_id: p.id, date: d, type: 'vacation', note }); continue; }
      // Zapsaný příchod = člověk ten den pracoval → necháváme být.
      if (found.clock_in) continue;
      if (found.type !== 'vacation' || found.note !== note) toUpdate.push({ id: found.id });
    }
  }
  if (toCreate.length) await prisma.attendance.createMany({ data: toCreate, skipDuplicates: true });
  if (toUpdate.length) {
    await prisma.attendance.updateMany({
      where: { id: { in: toUpdate.map((u) => u.id) } },
      data: { type: 'vacation', note },
    });
  }
  return toCreate.length + toUpdate.length;
}

// GET /api/hr/company-leave
router.get('/company-leave', async (req, res, next) => {
  try {
    const leaves = await prisma.companyLeave.findMany({ orderBy: { date_from: 'desc' } });
    res.json(leaves);
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/company-leave
router.post('/company-leave', async (req, res, next) => {
  try {
    const { error, data } = parseCompanyLeaveBody(req.body);
    if (error) return res.status(400).json({ error });
    const leave = await prisma.companyLeave.create({ data });
    let attendance_days = 0;
    try { attendance_days = await syncCompanyLeaveToAttendance(leave); }
    catch (e) { console.warn('[hr] propis celozávodní dovolené do docházky:', e.message); }
    res.status(201).json({ ...leave, attendance_days });
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/company-leave/:id
router.put('/company-leave/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Neplatné ID.' });
    const { error, data } = parseCompanyLeaveBody(req.body);
    if (error) return res.status(400).json({ error });
    const leave = await prisma.companyLeave.update({ where: { id }, data });
    // Termín nebo výjimky se mohly změnit → docházku přegenerujeme načisto.
    let attendance_days = 0;
    try {
      await clearCompanyLeaveAttendance(id);
      attendance_days = await syncCompanyLeaveToAttendance(leave);
    } catch (e) { console.warn('[hr] přepis docházky celozávodní dovolené:', e.message); }
    res.json({ ...leave, attendance_days });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/hr/company-leave/:id
router.delete('/company-leave/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Neplatné ID.' });
    await clearCompanyLeaveAttendance(id);
    await prisma.companyLeave.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── OPRÁVNĚNÍ (permissions) ──────────────────────────────────────────────

// GET /api/hr/permissions
router.get('/permissions', async (req, res, next) => {
  try {
    const { role_id } = req.query;
    const where = {};
    if (role_id) where.role_id = parseInt(role_id);

    const permissions = await prisma.permission.findMany({
      where,
      include: { role: { select: { id: true, name: true } } },
      orderBy: [{ role_id: 'asc' }, { module_id: 'asc' }],
    });
    res.json(permissions);
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/permissions/:roleId
// Přijme buď array `{ permissions: [{ module_id, access_level }, ...] }`,
// nebo mapu `{ module_id: access_level, ... }` (frontend lide-hr ji posílá takhle).
// Záznamy s 'none' nebo prázdnou hodnotou se neukládají — chybí = nemá přístup.
router.post('/permissions/:roleId', requireAdmin, async (req, res, next) => {
  try {
    const roleId = parseInt(req.params.roleId);
    if (Number.isNaN(roleId)) {
      return res.status(400).json({ error: 'Neplatné role_id' });
    }

    const body = req.body || {};
    let permArr = [];
    if (Array.isArray(body.permissions)) {
      permArr = body.permissions;
    } else if (Array.isArray(body)) {
      permArr = body;
    } else if (body.permissions && typeof body.permissions === 'object') {
      permArr = Object.entries(body.permissions).map(([module_id, access_level]) => ({ module_id, access_level }));
    } else if (typeof body === 'object') {
      // Holá mapa { module_id: access_level } přímo v body
      permArr = Object.entries(body)
        .filter(([k, v]) => typeof v === 'string' && k !== 'permissions')
        .map(([module_id, access_level]) => ({ module_id, access_level }));
    }

    // Normalizace + filtr neplatných / 'none' záznamů
    const toCreate = permArr
      .filter(p => p && p.module_id && typeof p.access_level === 'string' && p.access_level !== 'none')
      .map(p => ({
        role_id: roleId,
        module_id: String(p.module_id),
        access_level: p.access_level,
      }));

    // Smazat stávající a vytvořit nové (transakce)
    await prisma.$transaction([
      prisma.permission.deleteMany({ where: { role_id: roleId } }),
      ...toCreate.map(data => prisma.permission.create({ data })),
    ]);

    const updated = await prisma.permission.findMany({
      where: { role_id: roleId },
      orderBy: { module_id: 'asc' },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});


// Odpracované minuty jednoho dne docházky. Přednost mají časy upravené vedoucím
// (adjusted_*), teprve když chybí, použijí se čipové. Stejné pravidlo jako
// souhrn „Odprac. (uprav.)" na záložce Docházka. (Požadavek #144)
function workedMinutesOf(a) {
  const clockIn = a.adjusted_clock_in || a.clock_in;
  const clockOut = a.adjusted_clock_out || a.clock_out;
  if (!clockIn || !clockOut) return 0;
  const [ih, im] = clockIn.split(':').map(Number);
  const [oh, om] = clockOut.split(':').map(Number);
  if ([ih, im, oh, om].some((n) => !Number.isFinite(n))) return 0;
  const brk = a.adjusted_break != null ? a.adjusted_break : (a.break_minutes || 0);
  return Math.max(0, (oh * 60 + om) - (ih * 60 + im) - brk);
}

// ─── HR STATISTIKY ─────────────────────────────────────────────────────────

// GET /api/hr/stats
router.get('/stats', async (req, res, next) => {
  try {
    // POZOR: ne new Date().setHours(0,0,0,0) — proces běží s TZ=Europe/Prague,
    // takže by to vyšlo na 23:00 UTC předešlého dne a karta „Dnes přítomno"
    // by počítala VČEREJŠEK. nowInPrague() vrací UTC půlnoc pražského dne,
    // což je přesně to, co Prisma čeká u @db.Date. (Požadavek #134)
    const { today } = nowInPrague();
    await reconcileFormerEmployees(); // bývalí (skončený poměr) → 'former', ať se nepočítají

    const [employees, contacts, departments, presentRows] = await Promise.all([
      prisma.person.count({ where: { active: true, type: 'employee' } }),
      // Bývalí zaměstnanci se nepočítají ani do „kontaktů".
      prisma.person.count({ where: { active: true, type: { notIn: ['employee', 'former'] } } }),
      prisma.department.count(),
      // Přítomný = má dnes příchod a nemá odchod. Jen type 'work' (otevřená
      // přestávka je samostatný řádek) a distinct, ať se nikdo nepočítá dvakrát.
      prisma.attendance.findMany({
        where: { date: today, type: 'work', clock_in: { not: null }, clock_out: null },
        select: { person_id: true },
        distinct: ['person_id'],
      }),
    ]);

    res.json({ employees, contacts, departments, presentToday: presentRows.length });
  } catch (err) {
    next(err);
  }
});

// ─── DOKUMENTY ────────────────────────────────────────────────────────────

// GET /api/hr/documents
router.get('/documents', async (req, res, next) => {
  try {
    const { person_id, type, category, status } = req.query;
    const where = {};
    if (person_id) where.person_id = parseInt(person_id);
    if (type) where.type = type;
    if (category) where.category = category;
    if (status) where.status = status;

    const docs = await prisma.document.findMany({
      where,
      include: {
        person: { select: { id: true, first_name: true, last_name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    res.json(docs);
  } catch (err) {
    next(err);
  }
});

// GET /api/hr/documents/:id/download — stažení souboru (binární stream)
// Pozn.: pevná podcesta musí být DEFINOVÁNA NAD dynamickou /documents/:id
router.get('/documents/:id(\\d+)/download', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const doc = await prisma.document.findUnique({
      where: { id },
      select: { file_data: true, file_name: true, file_type: true, title: true },
    });
    if (!doc || !doc.file_data) return res.status(404).json({ error: 'Soubor nenalezen' });
    // file_data může být uložené jako čistý base64 NEBO jako data-URL ("data:application/pdf;base64,..."),
    // protože UI v existujícím tabu Dokumenty ukládá výstup z FileReader.readAsDataURL().
    // Ošetříme oba případy.
    const raw = String(doc.file_data || '');
    const b64 = raw.startsWith('data:') ? raw.split(',', 2)[1] || '' : raw;
    const buf = Buffer.from(b64, 'base64');
    const safeName = (doc.file_name || doc.title || 'dokument').replace(/[\r\n"]/g, '');
    res.setHeader('Content-Type', doc.file_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(safeName)}"`);
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

// GET /api/hr/documents/:id
router.get('/documents/:id', async (req, res, next) => {
  try {
    const doc = await prisma.document.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        person: { select: { id: true, first_name: true, last_name: true } },
        notifications: true,
      },
    });
    if (!doc) return res.status(404).json({ error: 'Dokument nenalezen' });
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/documents
router.post('/documents', async (req, res, next) => {
  try {
    const doc = await prisma.document.create({
      data: req.body,
      include: { person: { select: { id: true, first_name: true, last_name: true } } },
    });
    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/documents/:id
router.put('/documents/:id', async (req, res, next) => {
  try {
    const doc = await prisma.document.update({
      where: { id: parseInt(req.params.id) },
      data: req.body,
    });
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/hr/documents/:id
router.delete('/documents/:id', async (req, res, next) => {
  try {
    await prisma.document.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── ŠABLONY DOKUMENTŮ ───────────────────────────────────────────────────

// GET /api/hr/document-templates
router.get('/document-templates', async (req, res, next) => {
  try {
    const templates = await prisma.documentTemplate.findMany({ orderBy: { name: 'asc' } });
    res.json(templates);
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/document-templates
router.post('/document-templates', async (req, res, next) => {
  try {
    const template = await prisma.documentTemplate.create({ data: req.body });
    res.status(201).json(template);
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/document-templates/:id
router.put('/document-templates/:id', async (req, res, next) => {
  try {
    const template = await prisma.documentTemplate.update({
      where: { id: parseInt(req.params.id) },
      data: req.body,
    });
    res.json(template);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/hr/document-templates/:id
router.delete('/document-templates/:id', async (req, res, next) => {
  try {
    await prisma.documentTemplate.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/document-templates/generate — vygenerovat dokument ze šablony
router.post('/document-templates/generate', async (req, res, next) => {
  try {
    const { template_id, person_id, variables } = req.body;
    const template = await prisma.documentTemplate.findUnique({ where: { id: template_id } });
    if (!template) return res.status(404).json({ error: 'Šablona nenalezena' });

    const person = await prisma.person.findUnique({
      where: { id: person_id },
      include: { department: true, role: true, shift: true },
    });
    if (!person) return res.status(404).json({ error: 'Osoba nenalezena' });

    // Nahradit placeholdery
    let content = template.content;
    const replacements = {
      jmeno: person.first_name,
      prijmeni: person.last_name,
      cele_jmeno: `${person.first_name} ${person.last_name}`,
      email: person.email || '',
      telefon: person.phone || '',
      rodne_cislo: person.birth_number || '',
      datum_narozeni: person.birth_date ? new Date(person.birth_date).toLocaleDateString('cs-CZ') : '',
      adresa: person.address || '',
      mesto: person.city || '',
      psc: person.zip || '',
      cislo_op: person.id_card_number || '',
      cislo_zamestnance: person.employee_number || '',
      datum_nastupu: person.hire_date ? new Date(person.hire_date).toLocaleDateString('cs-CZ') : '',
      oddeleni: person.department?.name || '',
      pozice: person.role?.name || '',
      smennost: person.shift?.name || '',
      hodinova_sazba: person.hourly_rate ? String(person.hourly_rate) : '',
      mesicni_plat: person.monthly_salary ? String(person.monthly_salary) : '',
      bankovni_ucet: person.bank_account || '',
      datum_dnes: new Date().toLocaleDateString('cs-CZ'),
      ...variables,
    };

    for (const [key, value] of Object.entries(replacements)) {
      content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'gi'), value || '');
    }

    res.json({
      content,
      template_name: template.name,
      person_name: `${person.first_name} ${person.last_name}`,
    });
  } catch (err) {
    next(err);
  }
});

// ─── NOTIFIKACE DOKUMENTŮ ────────────────────────────────────────────────

// GET /api/hr/document-notifications
router.get('/document-notifications', async (req, res, next) => {
  try {
    const { person_id, dismissed } = req.query;
    const where = {};
    if (person_id) where.person_id = parseInt(person_id);
    if (dismissed !== undefined) where.dismissed = dismissed === 'true';

    const notifications = await prisma.documentNotification.findMany({
      where,
      include: {
        document: { select: { id: true, title: true, type: true, valid_to: true } },
        person: { select: { id: true, first_name: true, last_name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    res.json(notifications);
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/document-notifications
router.post('/document-notifications', async (req, res, next) => {
  try {
    const notif = await prisma.documentNotification.create({ data: req.body });
    res.status(201).json(notif);
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/document-notifications/:id
router.put('/document-notifications/:id', async (req, res, next) => {
  try {
    const notif = await prisma.documentNotification.update({
      where: { id: parseInt(req.params.id) },
      data: req.body,
    });
    res.json(notif);
  } catch (err) {
    next(err);
  }
});

// (Kiosk endpointy přesunuty PŘED requireAuth — viz začátek souboru)

// ─── SPRÁVA ÚČTŮ ZAMĚSTNANCŮ ─────────────────────────────────────────────

// POST /api/hr/people/:id/account — vytvoří uživatelský účet pro osobu
router.post('/people/:id/account', requireAdmin, async (req, res, next) => {
  try {
    const personId = parseInt(req.params.id);
    const person = await prisma.person.findUnique({ where: { id: personId } });
    if (!person) return res.status(404).json({ error: 'Osoba nenalezena' });
    if (person.user_id) return res.status(400).json({ error: 'Osoba již má účet' });

    const bcrypt = require('bcryptjs');
    const { username, password, role } = req.body;
    if (role === 'admin' && !req.user.isSuperAdmin) return res.status(403).json({ error: 'Roli administrátora může přidělit pouze super admin' });
    if (!password || String(password).length < 8) return res.status(400).json({ error: 'Heslo musí mít aspoň 8 znaků' });
    const hash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        username: username || person.email || `user_${personId}`,
        display_name: `${person.first_name} ${person.last_name}`,
        password_hash: hash,
        role: role || 'user',
      },
    });

    await prisma.person.update({
      where: { id: personId },
      data: { user_id: user.id, username: user.username },
    });

    res.status(201).json({ id: user.id, username: user.username, role: user.role });
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/people/:id/password — změna hesla zaměstnance
router.put('/people/:id/password', requireAdmin, async (req, res, next) => {
  try {
    const person = await prisma.person.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!person) return res.status(404).json({ error: 'Osoba nenalezena' });
    if (!person.user_id) return res.status(400).json({ error: 'Osoba nemá účet' });

    const bcrypt = require('bcryptjs');
    if (!req.body.password || String(req.body.password).length < 8) return res.status(400).json({ error: 'Heslo musí mít aspoň 8 znaků' });
    const target = await prisma.user.findUnique({ where: { id: person.user_id }, select: { role: true, is_super_admin: true } });
    if (target && (target.is_super_admin || target.role === 'admin') && !req.user.isSuperAdmin) return res.status(403).json({ error: 'Heslo administrátora může změnit pouze super admin' });
    const hash = await bcrypt.hash(req.body.password, 12);

    await prisma.user.update({
      where: { id: person.user_id },
      data: { password_hash: hash, token_version: { increment: 1 } },
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
