// =============================================================================
// HolyOS — Hugo Auth middleware (partner login pro bestseries.cash)
// Oddělené od interního User auth — partneři mají vlastní PartnerAccount + cookie.
// =============================================================================

const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');

const HUGO_SECRET = process.env.HUGO_COOKIE_SECRET
  || process.env.JWT_SECRET
  || process.env.SECRET
  || 'hugo-dev-secret-change-me';
const HUGO_EXPIRY = process.env.HUGO_TOKEN_EXPIRY || '30d'; // partner stays logged in a měsíc
const HUGO_COOKIE_NAME = 'hugo_token';

function generateHugoToken(partner) {
  return jwt.sign(
    {
      pid: partner.id,
      uname: partner.username,
      name: partner.display_name,
      lang: partner.language || 'cs',
    },
    HUGO_SECRET,
    { expiresIn: HUGO_EXPIRY }
  );
}

/**
 * Vytáhne partnera z httpOnly cookie nebo Authorization header.
 */
async function getPartnerFromRequest(req) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.cookies && req.cookies[HUGO_COOKIE_NAME]) {
    token = req.cookies[HUGO_COOKIE_NAME];
  }
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, HUGO_SECRET);
    if (!decoded || !decoded.pid) return null;
    const partner = await prisma.partnerAccount.findUnique({
      where: { id: decoded.pid },
      include: {
        company: { select: { id: true, name: true } },
        products: { select: { product_id: true, serial_no: true } },
      },
    });
    if (!partner || !partner.active) return null;
    return partner;
  } catch (_err) {
    return null;
  }
}

/**
 * Middleware — vyžaduje partner login. Nastavuje req.partner.
 */
async function requireHugoAuth(req, res, next) {
  try {
    const partner = await getPartnerFromRequest(req);
    if (!partner) return res.status(401).json({ error: 'Nepřihlášen — vyžadováno přihlášení partnera' });
    req.partner = partner;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Cookie options pro Hugo token. Použít jak při setCookie, tak clearCookie.
 */
function hugoCookieOptions(req) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dní
  };
}

module.exports = {
  generateHugoToken,
  requireHugoAuth,
  hugoCookieOptions,
  HUGO_COOKIE_NAME,
  HUGO_SECRET,
};
