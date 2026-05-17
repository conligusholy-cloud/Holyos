// =============================================================================
// HolyOS — Velín: middleware pro mobilní API
// =============================================================================
// Mobilní aplikace posílá Authorization: Bearer <token>. Token může být buď:
//
//   1) HolyOS JWT — vrácený z /api/auth/login (primární cesta pro Fázi 0c).
//      Vyžaduje, aby User měl propojený Person record (user.person není null).
//
//   2) Velín device token — vrácený z /api/velin/devices/activate
//      (alternativní cesta pro pracovníky bez HolyOS User accountu; flow
//      "PIN + aktivační kód", připraveno pro pozdější fázi).
//
// V obou případech middleware nastaví:
//   req.velin = { person, device } (device může být null pro JWT cestu)
//   req.user  = standardní HolyOS user objekt (jen pro JWT cestu)

const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');
const { verifySecret } = require('../services/velin/auth');
const { JWT_SECRET } = require('./auth');

async function tryJwt(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || !decoded.id) return null;
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { person: true },
    });
    if (!user || !user.person || !user.person.active) return null;
    return { user, person: user.person };
  } catch {
    return null;
  }
}

async function tryDeviceToken(token) {
  // Pro 5–50 zaměstnanců projdeme všechna aktivní zařízení a porovnáme
  // bcrypt hash. Při větší flotile přidat plain prefix index do tabulky.
  const devices = await prisma.deviceRegistration.findMany({
    where: { active: true },
    include: { person: true },
  });
  for (const d of devices) {
    // eslint-disable-next-line no-await-in-loop
    if (await verifySecret(token, d.device_token_hash)) {
      if (!d.person || !d.person.active) return null;
      return { device: d, person: d.person };
    }
  }
  return null;
}

async function requireVelinAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Chybí token' });
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      return res.status(401).json({ error: 'Prázdný token' });
    }

    // Primární cesta — HolyOS JWT. Rychlá: nejdřív verify JWT (synchronní
    // kontrola podpisu) — pokud projde, znamená to že je to HolyOS token a
    // můžeme se vyhnout pomalému bcrypt loopu nad device tokeny.
    const jwtMatch = await tryJwt(token);
    if (jwtMatch) {
      req.velin = { person: jwtMatch.person, device: null };
      req.user = {
        id: jwtMatch.user.id,
        username: jwtMatch.user.username,
        displayName: jwtMatch.user.display_name,
        role: jwtMatch.user.role,
        isSuperAdmin: jwtMatch.user.is_super_admin,
        person: jwtMatch.person,
      };
      return next();
    }

    // Sekundární cesta — Velín device token (PIN+aktivační kód flow).
    const deviceMatch = await tryDeviceToken(token);
    if (deviceMatch) {
      // Fire-and-forget last_seen update
      prisma.deviceRegistration
        .update({ where: { id: deviceMatch.device.id }, data: { last_seen_at: new Date() } })
        .catch((e) => console.warn('[velin-auth] last_seen update failed:', e.message));
      req.velin = { person: deviceMatch.person, device: deviceMatch.device };
      return next();
    }

    return res.status(401).json({ error: 'Neplatný token' });
  } catch (err) {
    console.error('[velin-auth] error:', err);
    next(err);
  }
}

// Zachováváme starý název pro zpětnou kompatibilitu — interně volá nový hybrid.
const requireVelinDevice = requireVelinAuth;

module.exports = { requireVelinAuth, requireVelinDevice };
