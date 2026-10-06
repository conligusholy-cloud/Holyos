// =============================================================================
// HolyOS — Auth routes
// =============================================================================

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { prisma } = require('../config/database');
const { generateToken, requireAuth, requireAdmin } = require('../middleware/auth');

// Určí, zda je uživatel "sales-only" (jen obchodní obrazovka, bez HolyOSu).
// Admin/super-admin NIKDY není sales-only. Sales-only = má sales flag, není admin
// a nemá žádná modulová práva (žádná role s permissions != none).
async function computeSalesAccess(user) {
  const person = user.person;
  const isAdmin = user.is_super_admin || user.role === 'admin' || (person && person.is_super_admin);
  const hasSales = !!(person && (person.is_salesperson || person.is_sales_lead));
  if (isAdmin || !hasSales) return { sales_only: false, sales_home: null };
  let allowedEmpty = true;
  if (person && person.role_id) {
    try {
      const role = await prisma.role.findUnique({ where: { id: person.role_id }, include: { permissions: true } });
      const allowed = ((role && role.permissions) || []).filter((p) => p.access_level && p.access_level !== 'none');
      allowedEmpty = allowed.length === 0;
    } catch (e) { allowedEmpty = true; }
  }
  if (!allowedEmpty) return { sales_only: false, sales_home: null };
  const home = person.is_sales_lead ? '/modules/vedouci-obchodu/index.html' : '/modules/obchodnik/index.html';
  return { sales_only: true, sales_home: home };
}

// GET /api/auth/setup — zkontroluje jestli existují uživatelé
router.get('/setup', async (req, res, next) => {
  try {
    const count = await prisma.user.count();
    res.json({ needsSetup: count === 0 });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/setup — vytvoří prvního admin uživatele (jen pokud žádný neexistuje)
router.post('/setup', async (req, res, next) => {
  try {
    const count = await prisma.user.count();
    if (count > 0) {
      return res.status(400).json({ error: 'Uživatelé již existují. Použijte /api/auth/login.' });
    }

    const { username, password, displayName } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Chybí username nebo password' });
    }

    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        username,
        password_hash: hash,
        display_name: displayName || username,
        role: 'admin',
        is_super_admin: true,
      },
    });

    const token = generateToken(user);
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
      ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
    });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        isSuperAdmin: user.is_super_admin,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Chybí jméno nebo heslo' });
    }

    const user = await prisma.user.findUnique({
      where: { username },
      include: { person: true },
    });

    if (!user) {
      return res.status(401).json({ error: 'Neplatné přihlašovací údaje' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Neplatné přihlašovací údaje' });
    }

    const access = await computeSalesAccess(user);
    const token = generateToken(user, { sales_only: access.sales_only, sales_home: access.sales_home });

    // Nastav cookie i vrať v body (podpora obou přístupů)
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24h
    });

    res.json({
      token,
      sales_only: access.sales_only,
      home: access.sales_home,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        isSuperAdmin: user.is_super_admin,
        person: user.person ? {
          id: user.person.id,
          firstName: user.person.first_name,
          lastName: user.person.last_name,
          photoUrl: user.person.photo_url,
          isSalesperson: !!user.person.is_salesperson,
          canGiveDiscount: !!user.person.can_give_discount,
          canAddIndividualOffers: !!user.person.can_add_individual_offers,
        } : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token', process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {});
  res.json({ ok: true });
});

// GET /api/auth/me — aktuální uživatel
// Vrátí i `allowed_modules` (mapa module_id → access_level), aby si sidebar
// a další moduly mohly filtrovat viditelnost. Admin a super admin nemají
// omezení — `allowed_modules` je v takovém případě `null` (= vidí vše).
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    let allowed_modules = null;

    if (!req.user.isSuperAdmin && req.user.role !== 'admin') {
      // Načti roli přihlášeného uživatele a její oprávnění (přes person → role)
      const person = await prisma.person.findFirst({
        where: { user_id: req.user.id },
        include: {
          role: {
            include: { permissions: true },
          },
        },
      });

      const perms = (person && person.role && person.role.permissions) || [];
      // Vrátíme mapu module_id → access_level. Hodnoty 'none' filtrujeme pryč,
      // takže když module_id v mapě není, znamená to "nemá přístup".
      allowed_modules = {};
      for (const p of perms) {
        if (p.access_level && p.access_level !== 'none') {
          allowed_modules[p.module_id] = p.access_level;
        }
      }
    }

    res.json({ user: req.user, allowed_modules, external_sections: await externalSectionsFor(req.user) });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Soukromá sekce „BS2" — samostatná aplikace (vlastní Railway služba + doména, např. bestseries2.cz),
// mechanicky oddělená od HolyOS. HolyOS jen: (1) ukáže odkaz v sidebaru vybraným lidem,
// (2) předá přihlášení krátkým podepsaným SSO tokenem (sdílený BS2_SSO_SECRET).
// Kdo ji vidí: BS2_ALLOWED_PERSON_IDS (čárkami), jinak výchozí Tomáš Holý + Jan Holý podle jména.
// =============================================================================
const jwt = require('jsonwebtoken');
async function bs2Allowed(user) {
  if (!process.env.BS2_URL) return false;
  const person = user && user.person;
  if (!person) return false;
  const ids = String(process.env.BS2_ALLOWED_PERSON_IDS || '').split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
  if (ids.length) return ids.includes(person.id);
  const fn = String(person.first_name || '').trim().toLowerCase(), ln = String(person.last_name || '').trim().toLowerCase();
  return ln === 'holý' && (fn === 'tomáš' || fn === 'jan');
}
async function externalSectionsFor(user) {
  const out = [];
  try {
    if (await bs2Allowed(user)) out.push({ id: 'bs2', name: process.env.BS2_NAME || 'Best Series 2.0', icon: '&#128101;', color: '#1e86e0', href: '/api/auth/sso/bs2' });
  } catch (e) { /* bez sekce */ }
  return out;
}
// GET /api/auth/sso/bs2 — přesměruje do BS2 s jednorázovým tokenem (platnost 2 min)
// Bez přihlášení do HolyOS (přímý odkaz, vypršelá cookie) → rovnou na přihlášení BS2.
// Záměr: nikdo, kdo míří do BS2, nesmí skončit na přihlašovací stránce HolyOS. Admin se do BS2 dostane z menu HolyOS.
function loginRedirectIfAnonymous(req, res, next) {
  const hasToken = (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) || (req.cookies && req.cookies.token);
  if (!hasToken) return res.redirect(String(process.env.BS2_URL || 'https://www.bestseries2.cz').replace(/\/$/, '') + '/login');
  next();
}
router.get('/sso/bs2', loginRedirectIfAnonymous, requireAuth, async (req, res, next) => {
  try {
    if (!(await bs2Allowed(req.user))) return res.status(403).send('Do této sekce nemáš přístup.');
    const secret = process.env.BS2_SSO_SECRET;
    if (!secret) return res.status(500).send('BS2_SSO_SECRET není nastaven.');
    const p = req.user.person;
    const token = jwt.sign({ uid: req.user.id, pid: p.id, name: ((p.first_name || '') + ' ' + (p.last_name || '')).trim(), username: req.user.username, aud: 'bs2', iss: 'holyos' }, secret, { expiresIn: '2m' });
    res.redirect(String(process.env.BS2_URL).replace(/\/$/, '') + '/sso?t=' + encodeURIComponent(token));
  } catch (err) { next(err); }
});

// GET /api/auth/bs2/products — aktivní stroje z prodejního ceníku pro záložku Produkty v BS2.
// Volá server BS2 (ne prohlížeč); ověřuje se krátkým JWT podepsaným sdíleným BS2_SSO_SECRET (aud 'holyos-api').
router.get('/bs2/products', async (req, res, next) => {
  try {
    const secret = process.env.BS2_SSO_SECRET;
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!secret || !m) return res.status(401).json({ error: 'Neautorizováno' });
    try { jwt.verify(m[1], secret, { audience: 'holyos-api', issuer: 'bs2' }); } catch (e) { return res.status(401).json({ error: 'Neplatný token' }); }
    const items = await prisma.salesPricelistItem.findMany({
      where: { active: true, kind: 'machine' },
      orderBy: [{ model_version: 'asc' }, { model_variant: 'asc' }, { name_cs: 'asc' }],
      select: { id: true, name_cs: true, name_en: true, price_czk: true, price_eur: true, truck_price_czk: true, truck_price_eur: true, truck_capacity: true, model_version: true, model_variant: true, machine_code: true, image_ext: true, image_updated_at: true },
    });
    res.json(items.map(i => ({ ...i, price_czk: i.price_czk == null ? null : Number(i.price_czk), price_eur: i.price_eur == null ? null : Number(i.price_eur), truck_price_czk: i.truck_price_czk == null ? null : Number(i.truck_price_czk), truck_price_eur: i.truck_price_eur == null ? null : Number(i.truck_price_eur) })));
  } catch (err) { next(err); }
});

// GET /api/auth/bs2/products/:id/image — obrázek položky ceníku pro BS2 (stejná autorizace tokenem)
router.get('/bs2/products/:id/image', async (req, res, next) => {
  try {
    const secret = process.env.BS2_SSO_SECRET;
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!secret || !m) return res.status(401).json({ error: 'Neautorizováno' });
    try { jwt.verify(m[1], secret, { audience: 'holyos-api', issuer: 'bs2' }); } catch (e) { return res.status(401).json({ error: 'Neplatný token' }); }
    const fs = require('fs'), path = require('path');
    const id = parseInt(req.params.id, 10);
    const it = await prisma.salesPricelistItem.findUnique({ where: { id }, select: { image_ext: true } });
    if (!it || !it.image_ext) return res.status(404).json({ error: 'Bez obrázku' });
    const file = path.join(__dirname, '..', 'data', 'pricelist-images', `pl-${id}.${it.image_ext}`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Soubor chybí' });
    const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[it.image_ext] || 'application/octet-stream';
    res.set('Content-Type', mime).set('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(file).pipe(res);
  } catch (err) { next(err); }
});

// GET /api/auth/users — seznam uživatelů (admin)
router.get('/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        display_name: true,
        role: true,
        is_super_admin: true,
        created_at: true,
      },
      orderBy: { username: 'asc' },
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/users — vytvořit uživatele (admin)
router.post('/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { username, password, displayName, role, isSuperAdmin } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Chybí username nebo password' });
    }

    // Roli admin a super admin může přidělit jen super admin
    if ((role === 'admin' || isSuperAdmin) && !req.user.isSuperAdmin) {
      return res.status(403).json({ error: 'Roli administrátora a super admina může přidělit pouze super admin' });
    }

    const hash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        username,
        password_hash: hash,
        display_name: displayName || username,
        role: role || 'user',
        is_super_admin: isSuperAdmin || false,
      },
      select: {
        id: true,
        username: true,
        display_name: true,
        role: true,
        is_super_admin: true,
        created_at: true,
      },
    });

    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

// PUT /api/auth/users/:id — upravit uživatele (admin)
router.put('/users/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { displayName, role, isSuperAdmin, password } = req.body;

    // Roli admin a super admin může přidělit jen super admin
    if ((role === 'admin' || isSuperAdmin) && !req.user.isSuperAdmin) {
      return res.status(403).json({ error: 'Roli administrátora a super admina může přidělit pouze super admin' });
    }

    const data = {};
    if (displayName !== undefined) data.display_name = displayName;
    if (role !== undefined) data.role = role;
    if (isSuperAdmin !== undefined) data.is_super_admin = isSuperAdmin;
    if (password) data.password_hash = await bcrypt.hash(password, 12);

    const user = await prisma.user.update({
      where: { id: parseInt(req.params.id) },
      data,
      select: {
        id: true,
        username: true,
        display_name: true,
        role: true,
        is_super_admin: true,
      },
    });

    res.json(user);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/auth/users/:id (admin)
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await prisma.user.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
