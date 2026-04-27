// =============================================================================
// HolyOS — HR routes (lidé, oddělení, role, docházka, dovolená)
// =============================================================================

const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { logAudit, diffObjects, makeSnapshot } = require('../services/audit');

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
      // Hledáme podle chip_number NEBO chip_card_id
      person = await prisma.person.findFirst({
        where: {
          active: true,
          OR: [
            { chip_number: chip_id },
            { chip_card_id: chip_id },
          ],
        },
        select: {
          id: true, first_name: true, last_name: true, photo_url: true,
          employee_number: true,
          department: { select: { id: true, name: true } },
          shift: true,
        },
      });
    }

    if (!person) return res.status(404).json({ error: 'Osoba nenalezena' });

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

    const request = await prisma.leaveRequest.create({
      data: {
        person_id: parseInt(person_id),
        type,
        date_from: new Date(date_from),
        date_to: new Date(date_to),
        note: note || null,
        status: 'pending',
      },
    });

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

// GET /api/hr/people
router.get('/people', async (req, res, next) => {
  try {
    const { search, type, department_id, active } = req.query;

    const where = {};
    if (type) where.type = type;
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

    res.json(people);
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
    res.json(person);
  } catch (err) {
    next(err);
  }
});

// Sanitizace dat pro Person model — jen povolená pole se správnými typy
// currentUser = req.user (volitelný) — pro kontrolu oprávnění
function sanitizePersonData(body, currentUser) {
  const data = {};
  // String pole
  const strFields = ['type', 'first_name', 'last_name', 'email', 'phone', 'notes',
    'employee_number', 'contract_type', 'birth_number', 'id_card_number', 'gender',
    'address', 'city', 'zip', 'bank_account', 'emergency_name', 'emergency_phone',
    'emergency_relation', 'photo_url', 'chip_number', 'chip_card_id', 'username'];
  for (const f of strFields) {
    if (f in body) data[f] = body[f] || null;
  }
  // Datum pole
  const dateFields = ['hire_date', 'end_date', 'birth_date'];
  for (const f of dateFields) {
    if (f in body) data[f] = body[f] ? new Date(body[f]) : null;
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
  // is_super_admin může měnit jen admin nebo super admin
  const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.isSuperAdmin);
  if ('is_super_admin' in body && isAdmin) {
    data.is_super_admin = toBool(body.is_super_admin);
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
router.post('/people', async (req, res, next) => {
  try {
    const person = await prisma.person.create({
      data: sanitizePersonData(req.body, req.user),
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
router.put('/people/:id', async (req, res, next) => {
  try {
    const before = await prisma.person.findUnique({ where: { id: parseInt(req.params.id) } });
    const person = await prisma.person.update({
      where: { id: parseInt(req.params.id) },
      data: sanitizePersonData(req.body, req.user),
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
router.delete('/people/:id', async (req, res, next) => {
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
router.post('/roles', async (req, res, next) => {
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
router.put('/roles/:id', async (req, res, next) => {
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
router.delete('/roles/:id', async (req, res, next) => {
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

// ─── SMĚNY ─────────────────────────────────────────────────────────────────

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
    const shift = await prisma.shift.create({ data: req.body });
    res.status(201).json(shift);
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/shifts/:id
router.put('/shifts/:id', async (req, res, next) => {
  try {
    const shift = await prisma.shift.update({
      where: { id: parseInt(req.params.id) },
      data: req.body,
    });
    res.json(shift);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/hr/shifts/:id
router.delete('/shifts/:id', async (req, res, next) => {
  try {
    await prisma.shift.delete({ where: { id: parseInt(req.params.id) } });
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

// ─── ŽÁDOSTI O DOVOLENOU ──────────────────────────────────────────────────

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
        person: { select: { id: true, first_name: true, last_name: true } },
        approver: { select: { id: true, first_name: true, last_name: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    res.json(requests);
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/leave-requests
router.post('/leave-requests', async (req, res, next) => {
  try {
    const request = await prisma.leaveRequest.create({
      data: req.body,
      include: { person: true },
    });
    res.status(201).json(request);
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/leave-requests/:id (schválení/zamítnutí)
router.put('/leave-requests/:id', async (req, res, next) => {
  try {
    const request = await prisma.leaveRequest.update({
      where: { id: parseInt(req.params.id) },
      data: req.body,
    });
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
router.put('/leave-requests/:id/approve', async (req, res, next) => {
  try {
    const request = await prisma.leaveRequest.update({
      where: { id: parseInt(req.params.id) },
      data: {
        status: 'approved',
        approved_by: req.body.approved_by || null,
      },
    });
    res.json(request);
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/leave-requests/:id/reject
router.put('/leave-requests/:id/reject', async (req, res, next) => {
  try {
    const request = await prisma.leaveRequest.update({
      where: { id: parseInt(req.params.id) },
      data: {
        status: 'rejected',
        approved_by: req.body.approved_by || null,
      },
    });
    res.json(request);
  } catch (err) {
    next(err);
  }
});

// ─── ZŮSTATKY DOVOLENÉ ────────────────────────────────────────────────────

// GET /api/hr/leave-balances
router.get('/leave-balances', async (req, res, next) => {
  try {
    const people = await prisma.person.findMany({
      where: { active: true, type: 'employee' },
      select: {
        id: true, first_name: true, last_name: true,
        leave_entitlement_days: true, leave_carryover: true,
        leave_requests: {
          where: {
            status: 'approved',
            date_from: { gte: new Date(new Date().getFullYear(), 0, 1) },
          },
        },
      },
    });

    const balances = people.map(p => {
      const entitlement = p.leave_entitlement_days || 20;
      const carryover = p.leave_carryover || 0;
      let usedDays = 0;
      for (const lr of p.leave_requests) {
        const from = new Date(lr.date_from);
        const to = new Date(lr.date_to);
        usedDays += Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
      }
      return {
        person_id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        entitlement: entitlement,
        carryover: carryover,
        total: entitlement + carryover,
        used: usedDays,
        remaining: entitlement + carryover - usedDays,
      };
    });

    res.json(balances);
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
router.post('/leave-settings', async (req, res, next) => {
  try {
    const settings = await prisma.leaveSettings.upsert({
      where: { id: 1 },
      update: req.body,
      create: { id: 1, ...req.body },
    });
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// ─── PŘESČASY ─────────────────────────────────────────────────────────────

// GET /api/hr/overtime-all
router.get('/overtime-all', async (req, res, next) => {
  try {
    const { year } = req.query;
    const targetYear = year ? parseInt(year) : new Date().getFullYear();
    const startDate = new Date(targetYear, 0, 1);
    const endDate = new Date(targetYear, 11, 31);

    const people = await prisma.person.findMany({
      where: { active: true, type: 'employee' },
      select: {
        id: true, first_name: true, last_name: true,
        shift: { select: { hours_fund: true } },
        attendance: {
          where: { date: { gte: startDate, lte: endDate } },
        },
      },
    });

    const overtimeData = people.map(p => {
      const dailyFund = p.shift ? parseFloat(p.shift.hours_fund) : 8;
      let totalOvertime = 0;
      for (const a of p.attendance) {
        if (a.clock_in && a.clock_out) {
          const [inH, inM] = a.clock_in.split(':').map(Number);
          const [outH, outM] = a.clock_out.split(':').map(Number);
          const worked = (outH + outM / 60) - (inH + inM / 60) - (a.break_minutes / 60);
          if (worked > dailyFund) totalOvertime += worked - dailyFund;
        }
      }
      return {
        person_id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        year: targetYear,
        overtime_hours: Math.round(totalOvertime * 100) / 100,
      };
    });

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
    const leave = await prisma.companyLeave.create({ data: req.body });
    res.status(201).json(leave);
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/company-leave/:id
router.put('/company-leave/:id', async (req, res, next) => {
  try {
    const leave = await prisma.companyLeave.update({
      where: { id: parseInt(req.params.id) },
      data: req.body,
    });
    res.json(leave);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/hr/company-leave/:id
router.delete('/company-leave/:id', async (req, res, next) => {
  try {
    await prisma.companyLeave.delete({ where: { id: parseInt(req.params.id) } });
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
router.post('/permissions/:roleId', async (req, res, next) => {
  try {
    const roleId = parseInt(req.params.roleId);
    const { permissions } = req.body; // [{ module_id, access_level }]

    // Smazat stávající a vytvořit nové (transakce)
    await prisma.$transaction([
      prisma.permission.deleteMany({ where: { role_id: roleId } }),
      ...permissions.map(p =>
        prisma.permission.create({
          data: { role_id: roleId, module_id: p.module_id, access_level: p.access_level },
        })
      ),
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

// ─── HR STATISTIKY ─────────────────────────────────────────────────────────

// GET /api/hr/stats
router.get('/stats', async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [employees, contacts, departments, presentToday] = await Promise.all([
      prisma.person.count({ where: { active: true, type: 'employee' } }),
      prisma.person.count({ where: { active: true, type: { not: 'employee' } } }),
      prisma.department.count(),
      prisma.attendance.count({ where: { date: today, clock_in: { not: null }, clock_out: null } }),
    ]);

    res.json({ employees, contacts, departments, presentToday });
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
router.post('/people/:id/account', async (req, res, next) => {
  try {
    const personId = parseInt(req.params.id);
    const person = await prisma.person.findUnique({ where: { id: personId } });
    if (!person) return res.status(404).json({ error: 'Osoba nenalezena' });
    if (person.user_id) return res.status(400).json({ error: 'Osoba již má účet' });

    const bcrypt = require('bcryptjs');
    const { username, password, role } = req.body;
    const hash = await bcrypt.hash(password || 'changeme', 12);

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
router.put('/people/:id/password', async (req, res, next) => {
  try {
    const person = await prisma.person.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!person) return res.status(404).json({ error: 'Osoba nenalezena' });
    if (!person.user_id) return res.status(400).json({ error: 'Osoba nemá účet' });

    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(req.body.password, 12);

    await prisma.user.update({
      where: { id: person.user_id },
      data: { password_hash: hash },
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
