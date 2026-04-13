// =============================================================================
// HolyOS — HR routes (lidé, oddělení, role, docházka, dovolená)
// =============================================================================

const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

// Všechny HR routy vyžadují autentizaci
router.use(requireAuth);

// ─── LIDÉ ──────────────────────────────────────────────────────────────────

// GET /api/hr/people
router.get('/people', async (req, res, next) => {
  try {
    const { search, type, department_id, active } = req.query;

    const where = {};
    if (type) where.type = type;
    if (department_id) where.department_id = parseInt(department_id);
    if (active !== undefined) where.active = active === 'true';
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

// POST /api/hr/people
router.post('/people', async (req, res, next) => {
  try {
    const person = await prisma.person.create({
      data: req.body,
      include: { department: true, role: true },
    });
    res.status(201).json(person);
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/people/:id
router.put('/people/:id', async (req, res, next) => {
  try {
    const person = await prisma.person.update({
      where: { id: parseInt(req.params.id) },
      data: req.body,
      include: { department: true, role: true },
    });
    res.json(person);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/hr/people/:id (soft delete)
router.delete('/people/:id', async (req, res, next) => {
  try {
    await prisma.person.update({
      where: { id: parseInt(req.params.id) },
      data: { active: false },
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
    res.status(201).json(dept);
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/departments/:id
router.put('/departments/:id', async (req, res, next) => {
  try {
    const dept = await prisma.department.update({
      where: { id: parseInt(req.params.id) },
      data: req.body,
    });
    res.json(dept);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/hr/departments/:id
router.delete('/departments/:id', async (req, res, next) => {
  try {
    await prisma.department.delete({ where: { id: parseInt(req.params.id) } });
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
    const role = await prisma.role.create({ data: req.body });
    res.status(201).json(role);
  } catch (err) {
    next(err);
  }
});

// PUT /api/hr/roles/:id
router.put('/roles/:id', async (req, res, next) => {
  try {
    const role = await prisma.role.update({
      where: { id: parseInt(req.params.id) },
      data: req.body,
    });
    res.json(role);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/hr/roles/:id
router.delete('/roles/:id', async (req, res, next) => {
  try {
    await prisma.role.delete({ where: { id: parseInt(req.params.id) } });
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

// GET /api/hr/attendance?person_id=&date_from=&date_to=
router.get('/attendance', async (req, res, next) => {
  try {
    const { person_id, date_from, date_to } = req.query;

    const where = {};
    if (person_id) where.person_id = parseInt(person_id);
    if (date_from || date_to) {
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

    res.json(records);
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

// ─── KIOSEK (příchod/odchod přes čip) ───────────────────────────────────

// POST /api/hr/kiosk/identify
router.post('/kiosk/identify', async (req, res, next) => {
  try {
    const { chip_number, chip_card_id } = req.body;
    const where = {};
    if (chip_number) where.chip_number = chip_number;
    else if (chip_card_id) where.chip_card_id = chip_card_id;
    else return res.status(400).json({ error: 'Chybí chip_number nebo chip_card_id' });

    const person = await prisma.person.findFirst({
      where: { ...where, active: true },
      select: {
        id: true, first_name: true, last_name: true, photo_url: true,
        department: { select: { id: true, name: true } },
        shift: true,
      },
    });

    if (!person) return res.status(404).json({ error: 'Osoba nenalezena' });
    res.json(person);
  } catch (err) {
    next(err);
  }
});

// POST /api/hr/kiosk/clock
router.post('/kiosk/clock', async (req, res, next) => {
  try {
    const { person_id, action } = req.body; // action: 'in' | 'out'
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (action === 'in') {
      const record = await prisma.attendance.create({
        data: {
          person_id: parseInt(person_id),
          date: today,
          clock_in: timeStr,
          type: 'work',
        },
      });
      res.status(201).json(record);
    } else if (action === 'out') {
      // Najít dnešní otevřený záznam
      const existing = await prisma.attendance.findFirst({
        where: {
          person_id: parseInt(person_id),
          date: today,
          clock_out: null,
        },
        orderBy: { clock_in: 'desc' },
      });

      if (!existing) return res.status(404).json({ error: 'Žádný otevřený příchod' });

      const record = await prisma.attendance.update({
        where: { id: existing.id },
        data: { clock_out: timeStr },
      });
      res.json(record);
    } else {
      res.status(400).json({ error: 'Neplatná akce (povoleno: in, out)' });
    }
  } catch (err) {
    next(err);
  }
});

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
