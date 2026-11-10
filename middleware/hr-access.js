// HolyOS — Přístupová práva k HR datům (modul lide-hr)
// Úrovně: 'admin' (admin / super admin), 'write', 'read', 'none' — podle oprávnění role osoby na modul lide-hr.
'use strict';
const { prisma } = require('../config/database');

const HR_MODULE = 'lide-hr';

async function hrLevel(user) {
  if (!user) return 'none';
  if (user.isSuperAdmin || user.role === 'admin') return 'admin';
  if (user._hrLevel) return user._hrLevel;
  let level = 'none';
  try {
    const person = await prisma.person.findFirst({
      where: { user_id: user.id },
      select: { role: { select: { permissions: { where: { module_id: HR_MODULE }, select: { access_level: true } } } } },
    });
    const p = person && person.role && person.role.permissions && person.role.permissions[0];
    if (p && p.access_level) level = String(p.access_level);
  } catch (e) { /* none */ }
  user._hrLevel = level;
  return level;
}

// Smí měnit HR data (admin nebo úroveň write)
function requireHrWrite(req, res, next) {
  hrLevel(req.user).then((l) => {
    if (l === 'admin' || l === 'write') return next();
    res.status(403).json({ error: 'Na tuto akci nemáte oprávnění (vyžadována úprava v modulu Lidé a HR).' });
  }).catch(next);
}

// ─── Právo editovat nárok na dovolenou (požadavek #139) ──────────────────────
// Vlastní modul v „Role a oprávnění", aby šlo nárok svěřit jen vybraným rolím.
// Když role nemá pro tento modul nic nastaveného, platí její úroveň na lide-hr —
// stávající role tím o nic nepřijdou.
const LEAVE_MODULE = 'hr-dovolena';

async function canEditLeave(user) {
  if (!user) return false;
  if (user.isSuperAdmin || user.role === 'admin') return true;
  try {
    const person = await prisma.person.findFirst({
      where: { user_id: user.id },
      select: { role: { select: { permissions: { where: { module_id: LEAVE_MODULE }, select: { access_level: true } } } } },
    });
    const p = person && person.role && person.role.permissions && person.role.permissions[0];
    if (p && p.access_level) return p.access_level === 'write';
  } catch (e) { /* spadneme na úroveň lide-hr níž */ }
  const l = await hrLevel(user);
  return l === 'admin' || l === 'write';
}

function requireLeaveEdit(req, res, next) {
  canEditLeave(req.user).then((ok) => {
    if (ok) return next();
    res.status(403).json({ error: 'Na úpravu nároku na dovolenou nemáte oprávnění.' });
  }).catch(next);
}

// Citlivé údaje osoby (rodné číslo, OP, účet, mzda) — jen admin, HR s právem úpravy, nebo osoba sama
const SENSITIVE_PERSON_FIELDS = ['birth_number', 'id_card_number', 'bank_account', 'hourly_rate', 'monthly_salary', 'birth_date'];
function stripSensitive(person) {
  if (!person) return person;
  const o = Object.assign({}, person);
  for (const f of SENSITIVE_PERSON_FIELDS) if (f in o) delete o[f];
  return o;
}
async function canSeeSensitive(user, personId) {
  const l = await hrLevel(user);
  if (l === 'admin' || l === 'write') return true;
  return !!(user && user.person && personId && user.person.id === personId);
}

module.exports = {
  hrLevel, requireHrWrite, stripSensitive, canSeeSensitive, SENSITIVE_PERSON_FIELDS,
  canEditLeave, requireLeaveEdit, LEAVE_MODULE,
};
