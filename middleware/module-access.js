// HolyOS — Serverová kontrola přístupu k modulu (dosud se oprávnění vynucovala jen v postranním menu)
// requireModule(['banky', 'ucetni-doklady']) → projde admin / super admin nebo uživatel, jehož role má
// u některého z modulů úroveň jinou než 'none'. Pozor: musí běžet PO requireAuth (req.user).
// requireModule(ids, { roles: ['obchodnik'], skip: ['/my'] }) → navíc projdou lidé s danou názvem role (bez diakritiky,
//   malými písmeny) a cesty ze `skip` se nekontrolují.
// auditModuleAccess(label, ids, opts) → NEBLOKUJE; jen zaloguje „[access-audit] DENY …", kdo by byl odmítnut
//   (pro sdílená API, než se podle logu vyladí seznam modulů a zapne vynucování). Funguje i před requireAuth.
'use strict';
const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function loadAccess(userId) {
  const map = {}; let roleName = '';
  try {
    const person = await prisma.person.findFirst({
      where: { user_id: userId },
      select: { role: { select: { name: true, permissions: { select: { module_id: true, access_level: true } } } } },
    });
    const role = person && person.role;
    roleName = norm(role && role.name);
    for (const p of (role && role.permissions) || []) if (p.access_level && p.access_level !== 'none') map[p.module_id] = p.access_level;
  } catch (e) { /* prázdná mapa = bez přístupu */ }
  return { map, roleName };
}

async function allowedModules(user) {
  if (!user) return {};
  if (user._allowedModules) return user._allowedModules;
  const a = await loadAccess(user.id);
  user._allowedModules = a.map; user._roleName = a.roleName;
  return a.map;
}

function requireModule(moduleIds, opts) {
  const ids = Array.isArray(moduleIds) ? moduleIds : [moduleIds];
  const roles = ((opts && opts.roles) || []).map(norm);
  const skip = (opts && opts.skip) || [];
  return async function (req, res, next) {
    try {
      const u = req.user;
      if (!u) return res.status(401).json({ error: 'Nepřihlášen' });
      if (u.isSuperAdmin || u.role === 'admin' || u.isApiKey) return next();
      if (skip.length && skip.includes(req.path)) return next();
      const map = await allowedModules(u);
      if (ids.some((id) => map[id])) return next();
      if (roles.length && roles.includes(u._roleName)) return next();
      return res.status(403).json({ error: 'Nemáte oprávnění k tomuto modulu.' });
    } catch (e) { next(e); }
  };
}

// ── Audit-only režim ─────────────────────────────────────────────────────
const cache = new Map();   // userId → { at, map, roleName, username, role, admin }
const lastLog = new Map(); // klíč → čas posledního logu (omezení spamu: 1× / 10 min na uživatele+API)
async function cached(payload) {
  const c = cache.get(payload.id);
  if (c && Date.now() - c.at < 60000) return c;
  const a = await loadAccess(payload.id);
  const e = { at: Date.now(), map: a.map, roleName: a.roleName };
  cache.set(payload.id, e);
  if (cache.size > 2000) cache.clear();
  return e;
}

function auditModuleAccess(label, moduleIds, opts) {
  const ids = Array.isArray(moduleIds) ? moduleIds : [moduleIds];
  const roles = ((opts && opts.roles) || []).map(norm);
  const secret = require('../config/secrets').jwtSecret();
  return function (req, res, next) {
    next(); // nikdy neblokuje a nezdržuje požadavek
    (async () => {
      try {
        let token = null;
        const h = req.headers.authorization;
        if (h && h.startsWith('Bearer ')) token = h.slice(7); else if (req.cookies && req.cookies.token) token = req.cookies.token;
        if (!token) return; // veřejné/kioskové endpointy bez tokenu se neřeší
        const p = jwt.verify(token, secret);
        if (p.is_super_admin || p.role === 'admin') return;
        const c = await cached(p);
        if (ids.some((id) => c.map[id]) || (roles.length && roles.includes(c.roleName))) return;
        const key = label + '|' + p.id;
        if (Date.now() - (lastLog.get(key) || 0) < 600000) return;
        lastLog.set(key, Date.now()); if (lastLog.size > 5000) lastLog.clear();
        console.warn('[access-audit] DENY api=' + label + ' user=' + p.username + ' role=' + (c.roleName || '-') + ' moduly=' + (Object.keys(c.map).join(',') || '-') + ' ' + req.method + ' ' + String(req.originalUrl).split('?')[0].slice(0, 80));
      } catch (e) { /* audit nesmí nic rozbít */ }
    })();
  };
}

module.exports = { requireModule, allowedModules, auditModuleAccess };
