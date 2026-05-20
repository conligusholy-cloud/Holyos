// =============================================================================
// HolyOS — Velín: middleware pro mobilní API
// =============================================================================
// Mobilní aplikace posílá Authorization: Bearer <token>. Token může být buď:
//
//   1) HolyOS JWT — vrácený z /api/auth/login (primární cesta pro Fázi 0c).
//      Vyžaduje, aby User měl propojený Person record (user.person není null).
//      Strukturálně: tři base64url segmenty oddělené '.'
//
//   2) Velín device token — vrácený z /api/velin/devices/activate
//      (alternativní cesta pro pracovníky bez HolyOS User accountu; flow
//      "PIN + aktivační kód", připraveno pro pozdější fázi).
//      Strukturálně: jeden souvislý base64url řetězec, žádné tečky.
//
// V obou případech middleware nastaví:
//   req.velin = { person, device } (device může být null pro JWT cestu)
//   req.user  = standardní HolyOS user objekt (jen pro JWT cestu)
//
// Optimalizace 2026-05-20:
//   Token nejdřív klasifikujeme tvarem (3 segmenty = JWT, 0 teček = device).
//   Tím se vyhneme pomalému bcrypt loopu nad všemi DeviceRegistration při
//   expirovaném JWT (původní implementace: 3–10 s navíc per request).

const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');
const { verifySecret } = require('../services/velin/auth');
const { JWT_SECRET } = require('./auth');

// Token vypadá jako JWT, pokud má přesně 3 segmenty oddělené '.' a každý
// segment je nenuločetný base64url. Ne ověřujeme podpis, jen tvar — verify
// pak udělá jwt.verify.
const JWT_SHAPE_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function looksLikeJwt(token) {
  return typeof token === 'string' && JWT_SHAPE_RE.test(token);
}

// Výsledek pokusu o JWT cestu:
//   { kind: 'ok', user, person }    — token je platný JWT navázaný na aktivního Person
//   { kind: 'expired' }             — JWT byl správně podepsaný, ale expiroval
//   { kind: 'invalid' }             — JWT podpis sedí, ale neexistuje user/person nebo person.active=false
//   { kind: 'bad' }                 — JWT verify selhal jinak (špatný podpis, malformed, …)
async function tryJwt(token) {
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    if (err && err.name === 'TokenExpiredError') return { kind: 'expired' };
    return { kind: 'bad' };
  }
  if (!decoded || !decoded.id) return { kind: 'invalid' };
  const user = await prisma.user.findUnique({
    where: { id: decoded.id },
    include: { person: true },
  });
  if (!user || !user.person || !user.person.active) return { kind: 'invalid' };
  return { kind: 'ok', user, person: user.person };
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
      return res.status(401).json({ error: 'Chybí token', code: 'missing_token' });
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      return res.status(401).json({ error: 'Prázdný token', code: 'empty_token' });
    }

    // 1) Token vypadá jako JWT → zkus jen JWT cestu, neiteruj device tokeny.
    //    To je hlavní rychlostní fix: dřív expirovaný JWT vyvolal bcrypt loop
    //    přes všechny DeviceRegistration (3–10 s).
    if (looksLikeJwt(token)) {
      const result = await tryJwt(token);
      if (result.kind === 'ok') {
        req.velin = { person: result.person, device: null };
        req.user = {
          id: result.user.id,
          username: result.user.username,
          displayName: result.user.display_name,
          role: result.user.role,
          isSuperAdmin: result.user.is_super_admin,
          person: result.person,
        };
        return next();
      }
      if (result.kind === 'expired') {
        return res
          .status(401)
          .json({ error: 'Token expiroval, přihlaš se znovu', code: 'token_expired' });
      }
      if (result.kind === 'invalid') {
        return res
          .status(401)
          .json({ error: 'Uživatel/Person není aktivní', code: 'token_user_inactive' });
      }
      return res.status(401).json({ error: 'Neplatný token', code: 'token_invalid' });
    }

    // 2) Token nevypadá jako JWT → zkus device token (PIN+aktivační kód flow).
    //    Tahle cesta je pomalá (bcrypt loop), ale teď se k ní dostaneme jen
    //    pokud token strukturálně nemůže být JWT.
    const deviceMatch = await tryDeviceToken(token);
    if (deviceMatch) {
      // Fire-and-forget last_seen update
      prisma.deviceRegistration
        .update({ where: { id: deviceMatch.device.id }, data: { last_seen_at: new Date() } })
        .catch((e) => console.warn('[velin-auth] last_seen update failed:', e.message));
      req.velin = { person: deviceMatch.person, device: deviceMatch.device };
      return next();
    }

    return res
      .status(401)
      .json({ error: 'Neznámý token', code: 'device_token_unknown' });
  } catch (err) {
    console.error('[velin-auth] error:', err);
    next(err);
  }
}

// Zachováváme starý název pro zpětnou kompatibilitu — interně volá nový hybrid.
const requireVelinDevice = requireVelinAuth;

module.exports = { requireVelinAuth, requireVelinDevice, looksLikeJwt };
