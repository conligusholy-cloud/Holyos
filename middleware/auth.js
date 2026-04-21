// =============================================================================
// HolyOS — Autentizace middleware (JWT)
// =============================================================================

const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || process.env.SECRET || 'holyos-dev-secret-change-me';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

/**
 * Vygeneruje JWT token pro uživatele
 */
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      display_name: user.display_name || user.username,
      role: user.role,
      is_super_admin: user.is_super_admin,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

/**
 * Middleware — vyžaduje platný JWT token
 */
async function requireAuth(req, res, next) {
  try {
    // Získej token z Authorization header nebo cookie
    let token = null;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({ error: 'Nepřihlášen — chybí token' });
    }

    // Ověř token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Načti uživatele z DB
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { person: true },
    });

    if (!user) {
      return res.status(401).json({ error: 'Uživatel neexistuje' });
    }

    // Přidej uživatele do requestu
    req.user = {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      isSuperAdmin: user.is_super_admin || (user.person && user.person.is_super_admin),
      person: user.person,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token vypršel' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Neplatný token' });
    }
    next(err);
  }
}

/**
 * Middleware — vyžaduje admin roli
 */
function requireAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && !req.user.isSuperAdmin)) {
    return res.status(403).json({ error: 'Přístup odmítnut — vyžadována role admin' });
  }
  next();
}

/**
 * Middleware — vyžaduje super admin oprávnění.
 * Používá se pro interní/ladicí moduly (CAD výkresy, AI Agenti, Dev Hub, atd.),
 * které nemají být viditelné ani použitelné běžnými uživateli.
 */
function requireSuperAdmin(req, res, next) {
  if (!req.user || !req.user.isSuperAdmin) {
    return res.status(403).json({ error: 'Přístup odmítnut — vyžadováno oprávnění super admin' });
  }
  next();
}

/**
 * Middleware — volitelná autentizace (nepřeruší pokud chybí token)
 */
async function optionalAuth(req, res, next) {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await prisma.user.findUnique({ where: { id: decoded.id }, include: { person: true } });
      if (user) {
        req.user = {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          role: user.role,
          isSuperAdmin: user.is_super_admin || (user.person && user.person.is_super_admin),
        };
      }
    }
  } catch {
    // Token neplatný — pokračujeme bez usera
  }
  next();
}

module.exports = {
  generateToken,
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
  optionalAuth,
  JWT_SECRET,
};
