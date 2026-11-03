// HolyOS — Serverová kontrola přístupu k modulu (dosud se oprávnění vynucovala jen v postranním menu)
// requireModule(['banky', 'ucetni-doklady']) → projde admin / super admin nebo uživatel, jehož role má
// u některého z modulů úroveň jinou než 'none'. Pozor: musí běžet PO requireAuth (req.user).
'use strict';
const { prisma } = require('../config/database');

async function allowedModules(user) {
  if (!user) return {};
  if (user._allowedModules) return user._allowedModules;
  const map = {};
  try {
    const person = await prisma.person.findFirst({
      where: { user_id: user.id },
      select: { role: { select: { permissions: { select: { module_id: true, access_level: true } } } } },
    });
    const perms = (person && person.role && person.role.permissions) || [];
    for (const p of perms) if (p.access_level && p.access_level !== 'none') map[p.module_id] = p.access_level;
  } catch (e) { /* prázdná mapa = bez přístupu */ }
  user._allowedModules = map;
  return map;
}

function requireModule(moduleIds) {
  const ids = Array.isArray(moduleIds) ? moduleIds : [moduleIds];
  return async function (req, res, next) {
    try {
      const u = req.user;
      if (!u) return res.status(401).json({ error: 'Nepřihlášen' });
      if (u.isSuperAdmin || u.role === 'admin' || u.isApiKey) return next();
      const map = await allowedModules(u);
      if (ids.some((id) => map[id])) return next();
      return res.status(403).json({ error: 'Nemáte oprávnění k tomuto modulu.' });
    } catch (e) { next(e); }
  };
}

module.exports = { requireModule, allowedModules };
