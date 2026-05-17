// =============================================================================
// HolyOS — Pracáček: middleware pro mobilní API (device token auth)
// =============================================================================
// Mobilní aplikace posílá Authorization: Bearer <device_token>. Middleware
// najde DeviceRegistration podle bcrypt hash matchu (musíme projít aktivní
// zařízení dané prefix kohorty — v MVP zkusíme všechny aktivní, je to OK
// pro <50 zařízení; později přidáme rychlejší lookup přes plaintext hash
// prvních 12 znaků jako bucket).
//
// req.pracacek = { person, device } po úspěšné autentizaci.

const { prisma } = require('../config/database');
const { verifySecret } = require('../services/pracacek/auth');

async function requirePracacekDevice(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Chybí device token' });
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      return res.status(401).json({ error: 'Prázdný device token' });
    }

    // Načteme všechna aktivní zařízení a porovnáme bcrypt hash.
    // Pro 5–50 zaměstnanců je to v pohodě (<50 ms). Pro větší flotilu
    // přidat sloupec `device_token_prefix` (prvních 8 znaků plain) jako
    // bucket index a hashujme jen jeho kandidáty.
    const devices = await prisma.deviceRegistration.findMany({
      where: { active: true },
      include: { person: true },
    });

    let matched = null;
    for (const d of devices) {
      // eslint-disable-next-line no-await-in-loop
      if (await verifySecret(token, d.device_token_hash)) {
        matched = d;
        break;
      }
    }

    if (!matched) {
      return res.status(401).json({ error: 'Neplatný device token' });
    }
    if (!matched.person || !matched.person.active) {
      return res.status(403).json({ error: 'Účet zaměstnance je deaktivovaný' });
    }

    // Aktualizuj last_seen_at (fire-and-forget, nečekáme)
    prisma.deviceRegistration
      .update({ where: { id: matched.id }, data: { last_seen_at: new Date() } })
      .catch((e) => console.warn('[pracacek-auth] last_seen update failed:', e.message));

    req.pracacek = {
      person: matched.person,
      device: matched,
    };
    next();
  } catch (err) {
    console.error('[pracacek-auth] error:', err);
    next(err);
  }
}

module.exports = { requirePracacekDevice };
