// =============================================================================
// HolyOS — Auth routes
// =============================================================================

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { createLimiter } = require('../middleware/rate-limit');
// Ochrana proti hádání hesel: 10 pokusů / 15 min na IP a 8 neúspěšných / 15 min na uživatelské jméno
const loginIpLimiter = createLimiter({ windowMs: 15 * 60000, max: 10, message: 'Příliš mnoho pokusů o přihlášení. Zkuste to za chvíli znovu.' });
const loginFailLimiter = createLimiter({ windowMs: 15 * 60000, max: 8 });
const loginKey = (u) => 'u:' + String(u || '').toLowerCase().slice(0, 100);
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

// Dokončení přihlášení: vydá token + cookie a vrátí profil (společné pro heslo i 2FA krok)
async function completeLogin(user, res) {
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
}

// POST /api/auth/login
router.post('/login', loginIpLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Chybí jméno nebo heslo' });
    }

    const user = await prisma.user.findUnique({
      where: { username },
      include: { person: true },
    });

    // Zámek účtu po opakovaných neúspěších (chrání i proti rozprostřenému útoku z více IP)
    const fk = loginKey(username);
    if (!user) { const r = loginFailLimiter.take(fk); if (r.blocked) { res.set('Retry-After', String(r.retryAfter)); return res.status(429).json({ error: 'Účet je dočasně uzamčen kvůli opakovaným pokusům. Zkuste to za chvíli.' }); } return res.status(401).json({ error: 'Neplatné přihlašovací údaje' }); }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const r = loginFailLimiter.take(fk);
      if (r.blocked) { res.set('Retry-After', String(r.retryAfter)); return res.status(429).json({ error: 'Účet je dočasně uzamčen kvůli opakovaným pokusům. Zkuste to za chvíli.' }); }
      return res.status(401).json({ error: 'Neplatné přihlašovací údaje' });
    }
    loginFailLimiter.reset(fk);

    // Dvoufaktorové ověření: heslo sedí → místo tokenu vydáme krátkodobou výzvu (5 min), token až po kódu z aplikace
    if (user.totp_enabled) {
      const challenge = jwt.sign({ tfa: user.id, p: 'login' }, require('../config/secrets').jwtSecret(), { expiresIn: '5m' });
      return res.json({ needs_2fa: true, challenge });
    }
    return completeLogin(user, res);
  } catch (err) {
    next(err);
  }
});


// ─── DVOUFAKTOROVÉ OVĚŘENÍ (TOTP) ───────────────────────────────────────────
const totp = require('../services/totp');
const tfaLimiter = createLimiter({ windowMs: 15 * 60000, max: 6, keyFn: (req) => 'tfa:' + (req.ip || '') , message: 'Příliš mnoho chybných kódů. Zkuste to za chvíli.' });
const tfaUserLimiter = createLimiter({ windowMs: 15 * 60000, max: 8 });

// Ověří kód z aplikace NEBO záložní kód (ten se spotřebuje). Vrací true/false.
async function checkTwoFactorCode(user, code) {
  const secret = totp.decrypt(user.totp_secret);
  if (secret && totp.verify(secret, code)) return true;
  const hash = totp.hashCode(code);
  const list = Array.isArray(user.totp_backup_codes) ? user.totp_backup_codes : [];
  if (list.includes(hash)) {
    await prisma.user.update({ where: { id: user.id }, data: { totp_backup_codes: list.filter((h) => h !== hash) } });
    return true;
  }
  return false;
}

// POST /api/auth/login/2fa { challenge, code } — druhý krok přihlášení
router.post('/login/2fa', loginIpLimiter, tfaLimiter, async (req, res, next) => {
  try {
    const { challenge, code } = req.body || {};
    let payload;
    try { payload = jwt.verify(String(challenge || ''), require('../config/secrets').jwtSecret()); } catch (e) { return res.status(401).json({ error: 'Platnost přihlášení vypršela — zadejte heslo znovu.' }); }
    if (!payload || payload.p !== 'login' || !payload.tfa) return res.status(401).json({ error: 'Neplatná výzva' });
    const fk = 'tfa-u:' + payload.tfa;
    const user = await prisma.user.findUnique({ where: { id: payload.tfa }, include: { person: true } });
    if (!user || !user.totp_enabled) return res.status(401).json({ error: 'Neplatná výzva' });
    if (!(await checkTwoFactorCode(user, code))) {
      const r = tfaUserLimiter.take(fk);
      if (r.blocked) { res.set('Retry-After', String(r.retryAfter)); return res.status(429).json({ error: 'Příliš mnoho chybných kódů. Zkuste to za chvíli.' }); }
      return res.status(401).json({ error: 'Neplatný ověřovací kód' });
    }
    tfaUserLimiter.reset(fk);
    return completeLogin(user, res);
  } catch (err) { next(err); }
});

// GET /api/auth/2fa/status
router.get('/2fa/status', requireAuth, async (req, res, next) => {
  try {
    const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { totp_enabled: true, totp_backup_codes: true } });
    res.json({ enabled: !!(u && u.totp_enabled), backup_codes_left: Array.isArray(u && u.totp_backup_codes) ? u.totp_backup_codes.length : 0 });
  } catch (err) { next(err); }
});

// POST /api/auth/2fa/setup — vygeneruje nový secret (zatím nezapnuto, čeká na potvrzení kódem)
router.post('/2fa/setup', requireAuth, async (req, res, next) => {
  try {
    const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { totp_enabled: true, username: true } });
    if (u.totp_enabled) return res.status(400).json({ error: '2FA už je zapnuté. Nejdřív ho vypněte.' });
    const secret = totp.generateSecret();
    await prisma.user.update({ where: { id: req.user.id }, data: { totp_secret: totp.encrypt(secret), totp_enabled: false } });
    res.json({ secret, otpauth: totp.otpauthUri(secret, u.username, 'HolyOS') });
  } catch (err) { next(err); }
});

// POST /api/auth/2fa/enable { code } — potvrdí kódem z aplikace, zapne 2FA a vrátí záložní kódy (zobrazí se jen jednou)
router.post('/2fa/enable', requireAuth, tfaLimiter, async (req, res, next) => {
  try {
    const u = await prisma.user.findUnique({ where: { id: req.user.id } });
    const secret = totp.decrypt(u.totp_secret);
    if (!secret || u.totp_enabled) return res.status(400).json({ error: 'Nejdřív spusťte nastavení 2FA.' });
    if (!totp.verify(secret, (req.body || {}).code)) return res.status(400).json({ error: 'Kód nesouhlasí. Zkontrolujte čas v telefonu a zkuste to znovu.' });
    const codes = totp.generateBackupCodes(8);
    await prisma.user.update({ where: { id: u.id }, data: { totp_enabled: true, totp_backup_codes: codes.map(totp.hashCode) } });
    require('../services/audit').logAudit({ action: 'update', entity: 'user', entity_id: u.id, description: 'Zapnuto dvoufaktorové ověření (2FA)', user: req.user }).catch(() => {});
    res.json({ ok: true, backup_codes: codes });
  } catch (err) { next(err); }
});

// POST /api/auth/2fa/disable { password, code } — vypnutí vyžaduje heslo i kód
router.post('/2fa/disable', requireAuth, tfaLimiter, async (req, res, next) => {
  try {
    const { password, code } = req.body || {};
    const u = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!u.totp_enabled) return res.json({ ok: true });
    if (!password || !(await bcrypt.compare(password, u.password_hash))) return res.status(401).json({ error: 'Nesprávné heslo' });
    if (!(await checkTwoFactorCode(u, code))) return res.status(401).json({ error: 'Neplatný ověřovací kód' });
    await prisma.user.update({ where: { id: u.id }, data: { totp_enabled: false, totp_secret: null, totp_backup_codes: null, token_version: { increment: 1 } } });
    require('../services/audit').logAudit({ action: 'update', entity: 'user', entity_id: u.id, description: 'Vypnuto dvoufaktorové ověření (2FA)', user: req.user }).catch(() => {});
    res.clearCookie('token', process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET/PUT /api/auth/2fa/policy — politika povinného 2FA (jen super admin)
router.get('/2fa/policy', requireAuth, async (req, res, next) => {
  try {
    if (!req.user.isSuperAdmin) return res.status(403).json({ error: 'Jen super admin' });
    const pol = await require('../services/two-factor-policy').getPolicy();
    const total = await prisma.user.count();
    const enrolled = await prisma.user.count({ where: { totp_enabled: true } });
    res.json({ policy: pol, users_total: total, users_enrolled: enrolled });
  } catch (err) { next(err); }
});
router.put('/2fa/policy', requireAuth, async (req, res, next) => {
  try {
    if (!req.user.isSuperAdmin) return res.status(403).json({ error: 'Jen super admin' });
    const b = req.body || {};
    // Pojistka: zapínající super admin musí mít 2FA sám, jinak by se mohl vyřadit
    if (b.enabled) { const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { totp_enabled: true } }); if (!me.totp_enabled) return res.status(400).json({ error: 'Nejdřív si zapněte 2FA sami.' }); }
    const pol = await require('../services/two-factor-policy').setPolicy(b);
    require('../services/audit').logAudit({ action: 'update', entity: 'security_policy', description: 'Politika povinného 2FA: ' + (pol.enabled ? 'zapnuto (odklad ' + pol.grace_days + ' dní)' : 'vypnuto'), user: req.user }).catch(() => {});
    res.json({ ok: true, policy: pol });
  } catch (err) { next(err); }
});

// POST /api/auth/users/:id/2fa-reset — super admin zruší 2FA uživateli (ztracený telefon i záložní kódy)
router.post('/users/:id/2fa-reset', requireAuth, async (req, res, next) => {
  try {
    if (!req.user.isSuperAdmin) return res.status(403).json({ error: 'Jen super admin' });
    const id = parseInt(req.params.id, 10);
    await prisma.user.update({ where: { id }, data: { totp_enabled: false, totp_secret: null, totp_backup_codes: null, token_version: { increment: 1 } } });
    require('../services/audit').logAudit({ action: 'update', entity: 'user', entity_id: id, description: 'Super admin zrušil 2FA uživateli', user: req.user }).catch(() => {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token', process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {});
  res.json({ ok: true });
});

// POST /api/auth/logout-all — odhlásí uživatele na VŠECH zařízeních (zneplatní všechny jeho tokeny)
router.post('/logout-all', requireAuth, async (req, res, next) => {
  try {
    await prisma.user.update({ where: { id: req.user.id }, data: { token_version: { increment: 1 } } });
    res.clearCookie('token', process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {});
    res.json({ ok: true });
  } catch (err) { next(err); }
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

    let twofa = null;
    try { const u2 = await prisma.user.findUnique({ where: { id: req.user.id }, select: { username: true, totp_enabled: true } }); twofa = await require('../services/two-factor-policy').statusFor(u2); } catch (e) { twofa = null; }
    res.json({ user: req.user, allowed_modules, external_sections: await externalSectionsFor(req.user), twofa });
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
// Laundromats (laundromats.eu) — samostatný server pro nové zájemce; admin kalendáře schůzek se otevírá přes SSO z HolyOS (LM_SSO_SECRET).
async function lmAllowed(user) {
  if (!process.env.LM_URL || !process.env.LM_SSO_SECRET) return false;
  const person = user && user.person;
  if (!person) return false;
  const ids = String(process.env.LM_ALLOWED_PERSON_IDS || process.env.BS2_ALLOWED_PERSON_IDS || '').split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
  if (ids.length) return ids.includes(person.id);
  const fn = String(person.first_name || '').trim().toLowerCase(), ln = String(person.last_name || '').trim().toLowerCase();
  return ln === 'holý' && (fn === 'tomáš' || fn === 'jan');
}
async function externalSectionsFor(user) {
  const out = [];
  try {
    if (await lmAllowed(user)) out.push({ id: 'laundromats', name: process.env.LM_NAME || 'Laundromats', icon: '&#129530;', color: '#3a6cf5', href: '/api/auth/sso/laundromats' });
    if (await bs2Allowed(user)) {
      out.push({ id: 'bs2', name: process.env.BS2_NAME || 'Best Series 2.0', icon: '&#128101;', color: '#1e86e0', href: '/api/auth/sso/bs2' });
      out.push({ id: 'ads', name: 'Centrum reklamy', icon: '&#128227;', color: '#f59e0b', href: '/modules/centrum-reklamy/index.html', internal: true });
      out.push({ id: 'milionar', name: 'Milionář (hra)', icon: '&#127918;', color: '#7c5cff', href: '/modules/milionar/index.html', internal: true });
    }
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

// GET /api/auth/sso/laundromats — přesměrování do administrace Laundromats s jednorázovým tokenem (platnost 2 min)
router.get('/sso/laundromats', requireAuth, async (req, res, next) => {
  try {
    if (!(await lmAllowed(req.user))) return res.status(403).send('Do této sekce nemáš přístup.');
    const p = req.user.person;
    const token = jwt.sign({ uid: req.user.id, pid: p.id, name: ((p.first_name || '') + ' ' + (p.last_name || '')).trim(), aud: 'laundromats', iss: 'holyos' }, process.env.LM_SSO_SECRET, { expiresIn: '2m' });
    res.redirect(String(process.env.LM_URL).replace(/\/$/, '') + '/sso?t=' + encodeURIComponent(token));
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
    // Obrázek se nabízí jen když soubor opravdu existuje na disku (jinak by BS2 ukázal rozbitý obrázek)
    const fsx = require('fs'), pathx = require('path');
    const imgDir = pathx.join(__dirname, '..', 'data', 'pricelist-images');
    items.forEach(i => { if (i.image_ext && !fsx.existsSync(pathx.join(imgDir, 'pl-' + i.id + '.' + i.image_ext))) { i.image_ext = null; i.image_updated_at = null; } });
    res.json(items.map(i => ({ ...i, price_czk: i.price_czk == null ? null : Number(i.price_czk), price_eur: i.price_eur == null ? null : Number(i.price_eur), truck_price_czk: i.truck_price_czk == null ? null : Number(i.truck_price_czk), truck_price_eur: i.truck_price_eur == null ? null : Number(i.truck_price_eur) })));
  } catch (err) { next(err); }
});

// POST /api/auth/bs2/send-mail — odeslání systémového e-mailu z BS2 (obnova hesla). Volá server BS2, ověření JWT sdíleným BS2_SSO_SECRET.
// Odkaz v e-mailu smí mířit jen na adresu BS2 (BS2_URL), aby endpoint nešel zneužít k rozesílání cizích odkazů.
router.post('/bs2/send-mail', express.json({ limit: '50kb' }), async (req, res, next) => {
  try {
    const secret = process.env.BS2_SSO_SECRET;
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!secret || !m) return res.status(401).json({ error: 'Neautorizováno' });
    try { jwt.verify(m[1], secret, { audience: 'holyos-api', issuer: 'bs2' }); } catch (e) { return res.status(401).json({ error: 'Neplatný token' }); }
    const b = req.body || {};
    const to = String(b.to || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: 'Neplatný příjemce' });
    const base = String(process.env.BS2_URL || 'https://www.bestseries2.cz').replace(/\/$/, '');
    const link = b.link ? String(b.link) : undefined;
    if (link) { // host odkazu musí odpovídat BS2_URL (www. se ignoruje)
      const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } };
      if (!/^https:\/\//.test(link) || hostOf(link) !== hostOf(base)) { console.warn('[bs2 mail] odkaz mimo BS2:', link, 'BS2_URL =', base); return res.status(400).json({ error: 'Odkaz mimo BS2' }); }
    }
    let our = null; try { our = await require('../services/settings').getOurCompany(); } catch (e) { our = null; }
    // Odesílatel: BS2_MAIL_FROM, jinak info@pradlomaty.info; když ho Graph odmítne (schránka neexistuje / není povolená), záloha = dosavadní fakturační schránka.
    // sender 'pradlomaty' (potvrzení schůzky) = stejný odesílatel a jméno jako e-maily z funelu (💧 PRÁDLOMATY 💧)
    const asPrad = b.sender === 'pradlomaty'; let pradFrom = null;
    if (asPrad) { try { pradFrom = await require('./compounder.routes').funnelMailFrom('schuzka', b.lang === 'pl' ? 'pl' : undefined); } catch (e) { pradFrom = null; } }
    const preferred = pradFrom || process.env.BS2_MAIL_FROM || 'info@pradlomaty.info';
    const fallback = process.env.SERVICE_BILLING_MAIL_FROM || (our && our.email) || process.env.COMPOUNDER_MAIL_FROM || undefined;
    const mailer = require('../services/email');
    const base2 = { to, brand: asPrad ? 'pradlomaty' : 'bs2', fromName: asPrad ? '💧 PRÁDLOMATY 💧' : (process.env.BS2_MAIL_FROM_NAME || 'Best Series 2.0'), subject: String(b.subject || 'Best Series 2.0').slice(0, 200), body: String(b.body || '').slice(0, 5000), link, linkLabel: b.linkLabel ? String(b.linkLabel).slice(0, 80) : undefined };
    // Volitelná kalendářová pozvánka (.ics) jako příloha — zákazník si schůzku jedním klikem přidá do kalendáře
    if (b.ics && typeof b.ics === 'string' && b.ics.indexOf('BEGIN:VCALENDAR') === 0 && b.ics.length < 20000) {
      base2.attachments = [{ filename: 'schuzka.ics', content: b.ics, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }];
    }
    let from = preferred;
    let r = await mailer.sendMail(Object.assign({}, base2, { from }));
    if ((!r || !r.sent) && fallback && fallback !== preferred) {
      console.warn('[bs2 mail] odeslání z ' + preferred + ' selhalo (' + (r && (r.error || r.skipped)) + '), zkouším ' + fallback);
      from = fallback;
      r = await mailer.sendMail(Object.assign({}, base2, { from }));
    }
    console.log('[bs2 mail] příjemce=' + to + ' from=' + from + ' výsledek=' + JSON.stringify({ sent: !!(r && r.sent), via: r && r.via, error: r && (r.error || r.skipped) }));
    if (!r || !r.sent) return res.status(502).json({ error: (r && (r.error || r.skipped)) || 'E-mail se nepodařilo odeslat' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/auth/lm/send-mail — potvrzení schůzky z laundromats.eu (samostatný server, VLASTNÍ tajemství LM_SSO_SECRET, ne BS2).
// Omezení: odkaz smí mířit jen na LM_URL (laundromats.eu), odesílatel je pevně „Prádlomaty" (jako e-maily z funelu).
router.post('/lm/send-mail', express.json({ limit: '50kb' }), async (req, res, next) => {
  try {
    const secret = process.env.LM_SSO_SECRET;
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!secret || !m) return res.status(401).json({ error: 'Neautorizováno' });
    try { jwt.verify(m[1], secret, { audience: 'holyos-api', issuer: 'laundromats' }); } catch (e) { return res.status(401).json({ error: 'Neplatný token' }); }
    const b = req.body || {};
    const to = String(b.to || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: 'Neplatný příjemce' });
    const base = String(process.env.LM_URL || 'https://laundromats.eu').replace(/\/$/, '');
    const link = b.link ? String(b.link) : undefined;
    if (link) {
      const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } };
      if (!/^https:\/\//.test(link) || hostOf(link) !== hostOf(base)) return res.status(400).json({ error: 'Odkaz mimo Laundromats' });
    }
    let pradFrom = null; try { pradFrom = await require('./compounder.routes').funnelMailFrom('schuzka', b.lang === 'pl' ? 'pl' : undefined); } catch (e) { pradFrom = null; }
    const from = pradFrom || process.env.COMPOUNDER_MAIL_FROM || undefined;
    const mail = { to, from, brand: 'pradlomaty', fromName: '💧 PRÁDLOMATY 💧', subject: String(b.subject || 'Laundromats').slice(0, 200), body: String(b.body || '').slice(0, 5000), link, linkLabel: b.linkLabel ? String(b.linkLabel).slice(0, 80) : undefined };
    if (b.ics && typeof b.ics === 'string' && b.ics.indexOf('BEGIN:VCALENDAR') === 0 && b.ics.length < 20000) mail.attachments = [{ filename: 'schuzka.ics', content: b.ics, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }];
    const r = await require('../services/email').sendMail(mail);
    console.log('[lm mail] příjemce=' + to + ' výsledek=' + JSON.stringify({ sent: !!(r && r.sent), error: r && (r.error || r.skipped) }));
    if (!r || !r.sent) return res.status(502).json({ error: (r && (r.error || r.skipped)) || 'E-mail se nepodařilo odeslat' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/auth/bs2/bulk-mail — jeden e-mail hromadné rozesílky z BS2 (Rozesílky). Odesílá se VÝHRADNĚ přes
// Amazon SES z adresy BS2_BULK_FROM (výchozí info@bestseries2.cz) — adresa musí být v Nastavení → odesílatelé SES
// a doména ověřená v SES. Reply-To = BS2_BULK_REPLY_TO (výchozí info@bestseries.cz, bestseries2.cz nemá MX). Odkaz na odhlášení vkládá BS2 sám (vlastní seznam vyřazených), proto unsubscribe:false.
// GET /api/auth/bs2/bulk-senders — odesílatelé, ze kterých smí jít rozesílka (= odesílatelé Amazon SES z Centra reklamy)
router.get('/bs2/bulk-senders', async (req, res, next) => {
  try {
    if (!verifyBs2Token(req, res)) return;
    const M = require('../services/ses/mailer');
    const list = M.isConfigured() ? (await M.sesSenders()).map((x) => ({ address: x.address, name: x.name || '' })) : [];
    res.json({ senders: list, default: process.env.BS2_BULK_FROM || 'info@bestseries2.cz', configured: M.isConfigured() });
  } catch (err) { next(err); }
});
router.post('/bs2/bulk-mail', express.json({ limit: '14mb' }), async (req, res, next) => {
  try {
    if (!verifyBs2Token(req, res)) return;
    const b = req.body || {};
    const to = String(b.to || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: 'Neplatný příjemce' });
    const M = require('../services/ses/mailer');
    const from = (b.from && /^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$/i.test(String(b.from).trim())) ? String(b.from).trim() : (process.env.BS2_BULK_FROM || 'info@bestseries2.cz');
    if (!M.isConfigured() || !(await M.sesSenderFor(from))) return res.status(503).json({ error: 'Odesílatel ' + from + ' není nastavený v Amazon SES (HolyOS → Nastavení → odesílatelé SES + ověřená doména).', code: 'no_ses_sender' });
    const hostOk = (u) => { try { const h = new URL(u).host.replace(/^www\./, '').toLowerCase(); return /^https:\/\//.test(u) && /(^|\.)(bestseries2\.cz|bestseries\.cz|laundromats\.eu|pradlomaty\.info|compounder\.world)$/.test(h); } catch (e) { return false; } };
    const link = b.link && hostOk(String(b.link)) ? String(b.link) : undefined;
    const unsub = b.unsubUrl && hostOk(String(b.unsubUrl)) ? String(b.unsubUrl) : null;
    const body = String(b.body || '').slice(0, 20000) + (unsub ? '\n\n—\nNechcete už od nás dostávat tyto e-maily? Odhlásit se můžete zde: ' + unsub : '');
    // Přílohy (base64) — max 7 MB dohromady
    let attachments; let total = 0;
    if (Array.isArray(b.attachments) && b.attachments.length) {
      attachments = b.attachments.slice(0, 5).map((x) => { const content = Buffer.from(String(x.data || ''), 'base64'); total += content.length; return { filename: String(x.filename || 'priloha').replace(/[\r\n"\\/]/g, '_').slice(0, 150), content, contentType: String(x.contentType || 'application/octet-stream').slice(0, 100) }; }).filter((x) => x.content.length);
      if (total > 7 * 1024 * 1024) return res.status(400).json({ error: 'Přílohy jsou větší než 7 MB.' });
    }
    const r = await require('../services/email').sendMail({ to, from, fromName: String(b.fromName || process.env.BS2_BULK_FROM_NAME || 'Best Series').slice(0, 80), brand: 'bs2', attachments, replyTo: process.env.BS2_BULK_REPLY_TO || 'info@bestseries.cz', subject: String(b.subject || 'Best Series').slice(0, 200), body, link, linkLabel: link && b.linkLabel ? String(b.linkLabel).slice(0, 80) : undefined, unsubscribe: false });
    if (!r || !r.sent) return res.status(502).json({ error: (r && (r.error || r.skipped)) || 'E-mail se nepodařilo odeslat' });
    res.json({ ok: true, via: r.via || null, messageId: r.messageId || null });
  } catch (err) { next(err); }
});

// POST /api/auth/bs2/invoice/proforma — BS2 odešle objednávku produktu → zálohová faktura (splatnost 3 dny) + e-mail zákazníkovi
// POST /api/auth/bs2/invoice/online   — BS2 odešle zaplacenou online objednávku (Stripe) → faktura + e-mail
function verifyBs2Token(req, res) {
  const secret = process.env.BS2_SSO_SECRET;
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!secret || !m) { res.status(401).json({ error: 'Neautorizováno' }); return false; }
  try { jwt.verify(m[1], secret, { audience: 'holyos-api', issuer: 'bs2' }); return true; } catch (e) { res.status(401).json({ error: 'Neplatný token' }); return false; }
}
router.post('/bs2/invoice/proforma', express.json({ limit: '100kb' }), async (req, res, next) => {
  try {
    if (!verifyBs2Token(req, res)) return;
    const b = req.body || {};
    if (!b.ref || !Array.isArray(b.items) || !b.items.length) return res.status(400).json({ error: 'Chybí ref nebo položky' });
    const r = await require('../services/bs2-billing').issueProforma(b);
    console.log('[bs2 invoice] záloha ref=' + b.ref + ' → ' + JSON.stringify(r));
    res.status(r.ok ? 200 : 422).json(r);
  } catch (err) { next(err); }
});
router.post('/bs2/invoice/online', express.json({ limit: '100kb' }), async (req, res, next) => {
  try {
    if (!verifyBs2Token(req, res)) return;
    const b = req.body || {};
    if (!b.ref || !Array.isArray(b.items) || !b.items.length) return res.status(400).json({ error: 'Chybí ref nebo položky' });
    const r = await require('../services/bs2-billing').issueOnline(b);
    console.log('[bs2 invoice] online ref=' + b.ref + ' → ' + JSON.stringify(r));
    res.status(r.ok ? 200 : 422).json(r);
  } catch (err) { next(err); }
});

// GET  /api/auth/bs2/invoices?refs=1,2,3 — stav faktur (záloha + finální) k objednávkám BS2 (ref = id objednávky v BS2)
// GET  /api/auth/bs2/invoice/:id/pdf     — PDF faktury z BS2 (jen faktury se zdrojem bs2_*)
// POST /api/auth/bs2/invoice/:id/send    — ruční (opětovné) odeslání faktury e-mailem odběrateli
router.get('/bs2/invoices', async (req, res, next) => {
  try {
    if (!verifyBs2Token(req, res)) return;
    const refs = String(req.query.refs || '').split(',').map((x) => parseInt(x, 10)).filter((n) => n > 0).slice(0, 300);
    const out = {};
    if (refs.length) {
      const rows = await prisma.invoice.findMany({
        where: { source: 'bs2_products', external_number: { in: refs.map((r) => 'BS2-O' + r) }, type: { in: ['proforma_issued', 'issued'] } },
        select: { id: true, invoice_number: true, type: true, external_number: true, status: true, delivery_status: true, sent_at: true, sent_to: true, send_error: true, total: true, paid_amount: true, currency: true, date_due: true },
        orderBy: { id: 'asc' },
      });
      rows.forEach((r) => {
        const ref = String(r.external_number).replace('BS2-O', '');
        out[ref] = out[ref] || {};
        out[ref][r.type === 'proforma_issued' ? 'proforma' : 'final'] = r;
      });
    }
    res.json(out);
  } catch (err) { next(err); }
});
router.get('/bs2/invoice/:id(\\d+)/pdf', async (req, res, next) => {
  try {
    if (!verifyBs2Token(req, res)) return;
    const inv = await prisma.invoice.findUnique({ where: { id: parseInt(req.params.id, 10) }, include: { company: true, items: { orderBy: { line_order: 'asc' } } } });
    if (!inv || !String(inv.source || '').startsWith('bs2_')) return res.status(404).json({ error: 'Faktura nenalezena' });
    const { generateInvoicePdf } = require('../services/pdf/invoice-pdf');
    const our = await require('../services/settings').getOurCompany().catch(() => null);
    const pdf = await generateInvoicePdf(inv, our || { name: 'Best Series s.r.o.' });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="' + inv.invoice_number + '.pdf"' }).send(pdf);
  } catch (err) { next(err); }
});
router.post('/bs2/invoice/:id(\\d+)/send', async (req, res, next) => {
  try {
    if (!verifyBs2Token(req, res)) return;
    const inv = await prisma.invoice.findUnique({ where: { id: parseInt(req.params.id, 10) }, select: { id: true, type: true, source: true } });
    if (!inv || !String(inv.source || '').startsWith('bs2_')) return res.status(404).json({ error: 'Faktura nenalezena' });
    const kind = inv.source === 'bs2_online' ? 'online' : (inv.type === 'proforma_issued' ? 'proforma' : 'final');
    const r = await require('../services/bs2-billing').sendInvoice(inv.id, kind);
    res.status(r.ok ? 200 : 502).json(r);
  } catch (err) { next(err); }
});

// POST /api/auth/bs2/invoice/cancel — objednávka v BS2 byla zrušena → zruší se nezaplacená zálohová faktura (zaplacená se nemění)
router.post('/bs2/invoice/cancel', express.json({ limit: '10kb' }), async (req, res, next) => {
  try {
    if (!verifyBs2Token(req, res)) return;
    const ref = parseInt((req.body || {}).ref, 10);
    if (!(ref > 0)) return res.status(400).json({ error: 'Chybí ref' });
    const pfs = await prisma.invoice.findMany({ where: { source: 'bs2_products', external_number: 'BS2-O' + ref, type: 'proforma_issued' } });
    const out = [];
    for (const pf of pfs) {
      const hasFinal = await prisma.invoice.findFirst({ where: { type: 'issued', parent_invoice_id: pf.id, source: 'bs2_products' }, select: { id: true } });
      const paid = pf.status === 'paid' || Number(pf.paid_amount || 0) > 0 || !!hasFinal;
      if (pf.status === 'cancelled') { out.push({ id: pf.id, already: true }); continue; }
      if (paid) { out.push({ id: pf.id, skipped: 'zaplaceno — nezrušeno, vyřešte ručně' }); continue; }
      await prisma.invoice.update({ where: { id: pf.id }, data: { status: 'cancelled' } });
      out.push({ id: pf.id, number: pf.invoice_number, cancelled: true });
    }
    console.log('[bs2 invoice] zrušení ref=' + ref + ' → ' + JSON.stringify(out));
    res.json({ ok: true, invoices: out });
  } catch (err) { next(err); }
});

// POST /api/auth/bs2/notify — push do Velína + zvonek v HolyOS pro Tomáše a Jana Holého (nová objednávka, převod, podnět, zpráva v BS2).
// Příjemci: AppSetting bs2.velin_notify_emails (JSON pole e-mailů) nebo výchozí tomas.holy@ + jan.holy@bestseries.cz (Person.email).
router.post('/bs2/notify', express.json({ limit: '20kb' }), async (req, res, next) => {
  try {
    const secret = process.env.BS2_SSO_SECRET;
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!secret || !m) return res.status(401).json({ error: 'Neautorizováno' });
    try { jwt.verify(m[1], secret, { audience: 'holyos-api', issuer: 'bs2' }); } catch (e) { return res.status(401).json({ error: 'Neplatný token' }); }
    const b = req.body || {};
    const title = String(b.title || 'Best Series 2.0').slice(0, 120);
    const body = String(b.body || '').slice(0, 300);
    const type = String(b.type || 'bs2').slice(0, 40);
    const { getSetting } = require('../services/settings');
    let emails = await getSetting('bs2.velin_notify_emails', { type: 'json', defaultValue: null }).catch(() => null);
    if (!Array.isArray(emails) || !emails.length) emails = ['tomas.holy@bestseries.cz', 'jan.holy@bestseries.cz'];
    const persons = await prisma.person.findMany({
      where: { active: true, OR: emails.map((e) => ({ email: { equals: String(e), mode: 'insensitive' } })) },
      select: { id: true, user_id: true },
    });
    // Záloha (když Person nemá e-mail vyplněný): shoda podle jména
    try {
      const have = new Set(persons.map((p) => p.id));
      const byName = await prisma.person.findMany({
        where: { active: true, last_name: { equals: 'Holý', mode: 'insensitive' }, first_name: { in: ['Tomáš', 'Jan'], mode: 'insensitive' } },
        select: { id: true, user_id: true },
      });
      byName.forEach((p) => { if (!have.has(p.id)) persons.push(p); });
    } catch (e) { console.warn('[bs2 notify] záloha podle jména:', e.message); }
    console.log('[bs2 notify] "' + title + '" → osoby: ' + (persons.map((p) => p.id).join(',') || 'ŽÁDNÁ (zkontroluj e-maily u Person / bs2.velin_notify_emails)'));
    const { notifyPerson } = require('../services/push/expo-push');
    const { createNotification } = require('./notifications.routes');
    const base = String(process.env.BS2_URL || 'https://www.bestseries2.cz').replace(/\/$/, '');
    const link = b.path ? base + String(b.path).slice(0, 200) : base + '/admin';
    const badge = Number.isFinite(Number(b.badge)) ? Math.max(0, Math.min(999, Math.floor(Number(b.badge)))) : undefined; // odznak na ikoně = počet nepřečtených
    const { supportSoundFor } = require('./velin.routes');
    for (const p of persons) {
      let snd = { sound: 'default', channelId: 'default' };
      if (type === 'support' && typeof supportSoundFor === 'function') { try { snd = await supportSoundFor(p.id); } catch (e) { /* výchozí zvuk */ } }
      notifyPerson(prisma, p.id, { title, body, data: { type: 'bs2_' + type, link }, sound: snd.sound, channelId: snd.channelId, badge }).catch((e) => console.warn('[bs2 notify] push', p.id, e.message));
      if (p.user_id) createNotification({ userId: p.user_id, type: 'system', title, body, link }).catch((e) => console.warn('[bs2 notify] zvonek', p.user_id, e.message));
    }
    res.json({ ok: true, recipients: persons.length });
  } catch (err) { next(err); }
});

// ─── Kalendář schůzek pro administraci BS2 (stejná data jako Prodejní objednávky → Termíny) ───
// GET    /api/auth/bs2/meetings?from=ISO&to=ISO  — termíny v rozsahu + rezervace (+ jméno leada)
// POST   /api/auth/bs2/meetings/slots            — založit termín(y): {starts_at, duration_min, capacity, mode, note} nebo {slots:[…]}
// PATCH  /api/auth/bs2/meetings/slots/:id        — upravit termín (čas, délka, kapacita, forma, poznámka, aktivní)
// DELETE /api/auth/bs2/meetings/slots/:id        — smazat termín (jen bez aktivní rezervace; jinak vypnout)
// PATCH  /api/auth/bs2/meetings/reservations/:id — stav rezervace {status: booked|done|canceled|no_show, note?}
// POST /api/auth/bs2/meeting-contacts — dohrání kontaktů Compounderu pro nové zájemce, kteří si v minulosti domluvili schůzku
// přes BS2 (těm se kontakt dřív nezakládal). Body: { contacts: [{ name, email, phone, mode }] }. Idempotentní (hledá podle e-mailu / telefonu),
// páruje i dosud nespárované rezervace. Vrací { created, existing, linked }.
router.post('/bs2/meeting-contacts', async (req, res, next) => {
  try {
    if (!verifyBs2Token(req, res)) return;
    const list = Array.isArray(req.body && req.body.contacts) ? req.body.contacts.slice(0, 2000) : [];
    let created = 0, existing = 0, linked = 0;
    for (const c of list) {
      const email = c.email ? String(c.email).trim().toLowerCase() : null;
      const phone = c.phone ? String(c.phone).trim().slice(0, 40) : null;
      if (!email && !phone) continue;
      const or = [];
      if (email) or.push({ email: { equals: email, mode: 'insensitive' } });
      if (phone) or.push({ phone });
      let lead = await prisma.compounderLead.findFirst({ where: { OR: or }, select: { id: true }, orderBy: { created_at: 'asc' } });
      if (lead) existing++;
      else {
        lead = await prisma.compounderLead.create({
          data: { name: String(c.name || email || phone || 'Kontakt ze schůzky').slice(0, 255), email, phone, source: 'meeting_bs2', role: 'compounder', status: c.mode === 'online' ? 'schuzka_online' : 'schuzka' },
          select: { id: true },
        });
        created++;
      }
      if (email) {
        const r = await prisma.meetingReservation.updateMany({ where: { compounder_lead_id: null, email: { equals: email, mode: 'insensitive' } }, data: { compounder_lead_id: lead.id } });
        linked += r.count;
      }
    }
    res.json({ ok: true, created, existing, linked });
  } catch (err) { next(err); }
});
const BS2_RES_STATUSES = ['booked', 'done', 'canceled', 'no_show'];
// Kalendář schůzek smí volat BS2 (BS2_SSO_SECRET) i Laundromats (LM_SSO_SECRET, iss laundromats) — jen routy níže, ne faktury ani produkty.
function verifyMeetingsToken(req, res) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (m) {
    const tries = [[process.env.BS2_SSO_SECRET, 'bs2'], [process.env.LM_SSO_SECRET, 'laundromats']];
    for (const [secret, iss] of tries) { if (!secret) continue; try { jwt.verify(m[1], secret, { audience: 'holyos-api', issuer: iss }); return true; } catch (e) { /* zkus další */ } }
  }
  res.status(401).json({ error: 'Neplatný token' }); return false;
}
// Automatické uvolňování termínů: GET nastavení + stav, PUT uložení (a okamžité spuštění), POST run (ruční spuštění)
router.get('/bs2/meetings-auto', async (req, res, next) => {
  try { if (!verifyMeetingsToken(req, res)) return; const A = require('../services/meetings/autorelease'); res.json({ ok: true, config: await A.getConfig(), status: await A.status() }); } catch (err) { next(err); }
});
router.put('/bs2/meetings-auto', express.json({ limit: '20kb' }), async (req, res, next) => {
  try { if (!verifyMeetingsToken(req, res)) return; const A = require('../services/meetings/autorelease'); const config = await A.saveConfig(req.body || {}); const r = config.enabled ? await A.run() : { created: 0 }; res.json({ ok: true, config, created: r.created || 0, status: await A.status() }); } catch (err) { next(err); }
});
router.post('/bs2/meetings-auto/run', async (req, res, next) => {
  try { if (!verifyMeetingsToken(req, res)) return; const A = require('../services/meetings/autorelease'); const r = await A.run({ force: true }); res.json({ ok: true, created: r.created || 0, days: r.days || [], status: await A.status() }); } catch (err) { next(err); }
});
router.get('/bs2/meetings', async (req, res, next) => {
  try {
    if (!verifyMeetingsToken(req, res)) return;
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 7 * 86400000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 60 * 86400000);
    if (isNaN(from) || isNaN(to)) return res.status(400).json({ error: 'Neplatný rozsah' });
    const slots = await prisma.meetingSlot.findMany({
      where: { starts_at: { gte: from, lt: to } },
      orderBy: { starts_at: 'asc' },
      include: { reservations: { orderBy: { created_at: 'asc' }, select: { id: true, name: true, email: true, phone: true, status: true, compounder_lead_id: true, created_at: true, note: true, mode: true, financing_path: true } } },
    });
    const leadIds = [...new Set(slots.flatMap((s) => s.reservations.map((r) => r.compounder_lead_id)).filter(Boolean))];
    const leads = leadIds.length ? await prisma.compounderLead.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true, email: true, phone: true, city: true, status: true, is_hot: true } }).catch(() => []) : [];
    const lm = new Map(leads.map((l) => [l.id, l]));
    res.json(slots.map((s) => ({
      id: s.id, starts_at: s.starts_at, duration_min: s.duration_min, capacity: s.capacity, mode: s.mode, note: s.note, active: s.active,
      booked: s.reservations.filter((r) => r.status === 'booked').length,
      reservations: s.reservations.map((r) => ({ ...r, lead: r.compounder_lead_id ? (lm.get(r.compounder_lead_id) || null) : null })),
    })));
  } catch (err) { next(err); }
});
// GET /api/auth/bs2/meetings-promises?from&to — slíbené kroky, které si Tomáš / Jan Holý
// hlídají sami (SalesEvent task u leada v jejich kalendáři). Administrace je ukáže žlutě ve Schůzkách.
router.get('/bs2/meetings-promises', async (req, res, next) => {
  try {
    if (!verifyMeetingsToken(req, res)) return;
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 7 * 86400000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 60 * 86400000);
    if (isNaN(from) || isNaN(to)) return res.status(400).json({ error: 'Neplatný rozsah' });
    const nrm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const holys = await prisma.person.findMany({ where: { last_name: { in: ['Holý', 'Holy', 'HOLÝ', 'HOLY'] } }, select: { id: true, first_name: true, last_name: true } }).catch(() => []);
    const bosses = holys.filter((p) => ['tomas', 'jan'].includes(nrm(p.first_name)));
    if (!bosses.length) return res.json([]);
    const bm = new Map(bosses.map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(' ')]));
    const evs = await prisma.salesEvent.findMany({
      where: { organizer_id: { in: bosses.map((p) => p.id) }, event_type: 'task', compounder_lead_id: { not: null }, status: { not: 'cancelled' }, start_at: { gte: from, lt: to } },
      orderBy: { start_at: 'asc' }, take: 500,
      select: { id: true, title: true, description: true, start_at: true, status: true, organizer_id: true, compounder_lead_id: true },
    });
    const lids = [...new Set(evs.map((e) => e.compounder_lead_id))];
    const leads = lids.length ? await prisma.compounderLead.findMany({ where: { id: { in: lids } }, select: { id: true, name: true, phone: true, email: true, city: true, owner_person_id: true } }).catch(() => []) : [];
    const lm = new Map(leads.map((l) => [l.id, l]));
    const oids = [...new Set(leads.map((l) => l.owner_person_id).filter(Boolean))];
    const owners = oids.length ? await prisma.person.findMany({ where: { id: { in: oids } }, select: { id: true, first_name: true, last_name: true } }).catch(() => []) : [];
    const om = new Map(owners.map((o) => [o.id, [o.first_name, o.last_name].filter(Boolean).join(' ')]));
    res.json(evs.map((e) => {
      const l = lm.get(e.compounder_lead_id) || {};
      return { id: e.id, starts_at: e.start_at, status: e.status, text: e.description || e.title, watcher: bm.get(e.organizer_id) || null,
        lead: { id: e.compounder_lead_id, name: l.name || null, phone: l.phone || null, email: l.email || null, city: l.city || null, owner: l.owner_person_id ? (om.get(l.owner_person_id) || null) : null } };
    }));
  } catch (err) { next(err); }
});
// GET /api/auth/bs2/meetings-stats?group=day|week|month|year&n=12
// Statistika schuzek pro administraci Laundromats: kolik schuzek na dane obdobi pripadlo
// a kolik z nich probehlo. Schuzka patri do obdobi podle TERMINU (slot.starts_at), ne podle
// data domluveni -- "domluveno" i "probehlo" jsou tak ve stejnem sloupci a da se z nich cist uspesnost.
// Uspesnost pocitame stejne jako vyhodnoceni obchodniku (services/meeting/owner-stats.js):
// probehle / vyresene, kde vyresene = probehle + nedorazil + zrusene + termin uz uplynul a nikdo stav neoznacil.
// Nadchazejici schuzky se do uspesnosti nepocitaji -- vysledek jeste neni znamy.
// Nase vlastni (testovaci) rezervace podle e-mailove domeny se nepocitaji; jejich pocet vracime zvlast.
const MST_TZ = 'Europe/Prague';
const MST_DOW = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
const MST_MON3 = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];
const MST_MON = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
// Datum tak, jak ho v dany okamzik vidi Praha (server bezi v UTC).
function mstParts(d) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: MST_TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
    .formatToParts(new Date(d)).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { y: +f.year, m: +f.month, d: +f.day, dow: DOW[f.weekday] };
}
// Pocitame v UTC poledne, aby prechod na letni/zimni cas nikdy neposunul datum o den vedle.
const mstNoon = (y, m, d) => Date.UTC(y, m - 1, d, 12, 0, 0);
const mstYmd = (t) => { const x = new Date(t); return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }; };
const mst2 = (n) => String(n).padStart(2, '0');
// Klic obdobi + popisky do grafu. Tyden zacina pondelim.
function mstBucket(group, p) {
  if (group === 'year') return { key: String(p.y), label: String(p.y), title: String(p.y) };
  if (group === 'day') {
    return {
      key: p.y + '-' + mst2(p.m) + '-' + mst2(p.d),
      label: MST_DOW[p.dow],
      sub: p.d + '. ' + p.m + '.',
      dow: p.dow,
      title: MST_DOW[p.dow] + ' ' + p.d + '. ' + p.m + '. ' + p.y,
    };
  }
  if (group === 'week') {
    const mon = mstYmd(mstNoon(p.y, p.m, p.d) - ((p.dow + 6) % 7) * 86400000);
    const sun = mstYmd(mstNoon(mon.y, mon.m, mon.d) + 6 * 86400000);
    return {
      key: mon.y + '-' + mst2(mon.m) + '-' + mst2(mon.d),
      label: mon.d + '. ' + mon.m + '.',
      title: mon.d + '. ' + mon.m + '. - ' + sun.d + '. ' + sun.m + '. ' + sun.y,
    };
  }
  return { key: p.y + '-' + mst2(p.m), label: MST_MON3[p.m - 1] + ' ' + mst2(p.y % 100), title: MST_MON[p.m - 1] + ' ' + p.y };
}
// Seznam obdobi od nejstarsiho po soucasne (vcetne) a jeste fwd obdobi dopredu,
// aby bylo videt, co uz je domluvene na pristi dny. Budouci obdobi maji future:true.
function mstBuckets(group, n, fwd) {
  const now = mstParts(Date.now());
  const out = [];
  for (let i = n - 1; i >= -(fwd || 0); i--) {
    if (group === 'year') out.push(mstBucket('year', { y: now.y - i, m: 1, d: 1, dow: 0 }));
    else if (group === 'day') {
      const t = mstNoon(now.y, now.m, now.d) - i * 86400000; const x = mstYmd(t);
      out.push(mstBucket('day', { y: x.y, m: x.m, d: x.d, dow: new Date(t).getUTCDay() }));
    } else if (group === 'week') {
      const x = mstYmd(mstNoon(now.y, now.m, now.d) - (((now.dow + 6) % 7) + i * 7) * 86400000);
      out.push(mstBucket('week', { y: x.y, m: x.m, d: x.d, dow: 1 }));
    } else {
      const mm = now.m - 1 - i; const y = now.y + Math.floor(mm / 12); const m = ((mm % 12) + 12) % 12 + 1;
      out.push(mstBucket('month', { y, m, d: 1, dow: 0 }));
    }
  }
  return out.map((x, i) => Object.assign(x, { future: i >= n }));
}
const mstCell = () => ({ booked: 0, done: 0, no_show: 0, canceled: 0, upcoming: 0, unmarked: 0 });
function mstAdd(c, status, startsAt, now) {
  c.booked++;
  if (status === 'canceled') c.canceled++;
  else if (status === 'done') c.done++;
  else if (status === 'no_show') c.no_show++;
  else if (new Date(startsAt).getTime() > now) c.upcoming++;
  else c.unmarked++;
}
function mstRate(c) {
  const resolved = c.done + c.no_show + c.canceled + c.unmarked;
  return resolved ? Math.round((c.done / resolved) * 1000) / 10 : null;
}
// Nase vlastni e-maily = testovaci rezervace, do statistiky nepatri.
function mstInternal(email) {
  const domains = String(process.env.ADS_INTERNAL_EMAIL_DOMAINS || 'bestseries.cz,bestseries2.cz,pradlomaty.info')
    .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const em = String(email || '').trim().toLowerCase();
  const at = em.lastIndexOf('@');
  return at > 0 && domains.indexOf(em.slice(at + 1)) !== -1;
}
// Zdroj schůzky: kdo ji domluvil. Obchodník = rezervace s booked_by_person_id (rezervoval v aplikaci obchodníka);
// Reklama = zákazník si termín vybral sám a kontakt přišel z reklamy (Meta / Google / LinkedIn formuláře, UTM);
// Sám z webu = ostatní samostatné rezervace (cesta z SMS / e-mailu, bestseries2.cz, pradlomaty.info…).
const MST_ADS_RE = /(facebook|fb_|meta|google|gads|linkedin|instagram|tiktok|_ads$|^ads)/i;
function mstSource(r, leadSrc) {
  if (r.booked_by_person_id) return { key: 'p:' + r.booked_by_person_id, kind: 'sales' };
  if (leadSrc && MST_ADS_RE.test(leadSrc)) return { key: 'ads', kind: 'ads' };
  return { key: 'self', kind: 'self' };
}
router.get('/bs2/meetings-stats', async (req, res, next) => {
  try {
    if (!verifyMeetingsToken(req, res)) return;
    const group = ['day', 'week', 'month', 'year'].includes(String(req.query.group)) ? String(req.query.group) : 'month';
    const nMax = group === 'year' ? 10 : group === 'week' ? 26 : group === 'day' ? 62 : 24;
    const n = Math.max(1, Math.min(nMax, parseInt(req.query.n, 10) || (group === 'year' ? 5 : group === 'day' ? 28 : 12)));
    // Kousek dopredu, at je videt, co uz je na pristi dny domluvene.
    const FWD = { day: 14, week: 2, month: 1, year: 0 };
    const fwd = Math.max(0, Math.min(62, req.query.fwd != null ? parseInt(req.query.fwd, 10) || 0 : FWD[group]));
    const buckets = mstBuckets(group, n, fwd);
    const idx = {}; buckets.forEach((b, i) => { idx[b.key] = i; });
    // Rozsah dotazu delame s rezervou na obou stranach; presne zatridi az klic obdobi v prazskem case.
    const nowP = mstParts(Date.now());
    const first = buckets[0].key;
    const from = group === 'year' ? new Date(Date.UTC(+first, 0, 1) - 2 * 86400000)
      : group === 'month' ? new Date(Date.UTC(+first.slice(0, 4), +first.slice(5, 7) - 1, 1) - 2 * 86400000)
        : new Date(Date.UTC(+first.slice(0, 4), +first.slice(5, 7) - 1, +first.slice(8, 10)) - 2 * 86400000);
    const to = group === 'year' ? new Date(Date.UTC(nowP.y + 1 + fwd, 0, 1) + 2 * 86400000)
      : group === 'month' ? new Date(Date.UTC(nowP.y, nowP.m + fwd, 1) + 2 * 86400000)
        : group === 'day' ? new Date(Date.now() + (fwd + 2) * 86400000)
          : new Date(Date.now() + (fwd * 7 + 9) * 86400000);
    const rows = await prisma.meetingReservation.findMany({
      where: { slot: { starts_at: { gte: from, lt: to } } },
      select: { status: true, email: true, mode: true, booked_by_person_id: true, compounder_lead_id: true, slot: { select: { starts_at: true } } },
    });
    // Schůzky na hale (mode hala / hala_cont = navazující termíny) se do statistik online schůzek nepočítají — mají vlastní trychtýř níže
    const hallRows = rows.filter((r) => r.mode === 'hala' && !mstInternal(r.email));
    const rowsAll = rows; rows.splice(0, rows.length, ...rowsAll.filter((r) => r.mode !== 'hala' && r.mode !== 'hala_cont'));
    // Zdroje: kontakt (source) + jména obchodníků — dvěma dotazy, ne po řádcích
    const leadIds = [...new Set(rows.map((r) => r.compounder_lead_id).filter(Boolean))];
    const leadRows = leadIds.length ? await prisma.compounderLead.findMany({ where: { id: { in: leadIds } }, select: { id: true, source: true, status: true } }).catch(() => []) : [];
    const leadSrc = new Map(leadRows.map((l) => [l.id, l.source || '']));
    const leadStatus = new Map(leadRows.map((l) => [l.id, l.status || '']));
    const pIds = [...new Set(rows.map((r) => r.booked_by_person_id).filter(Boolean))];
    const pName = new Map((pIds.length ? await prisma.person.findMany({ where: { id: { in: pIds } }, select: { id: true, first_name: true, last_name: true } }).catch(() => []) : []).map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(' ')]));
    const src = String(req.query.src || 'all');
    const srcMatch = (s) => src === 'all' || src === s.kind || src === s.key;
    const bySrc = {};
    const now = Date.now();
    const cells = buckets.map(() => mstCell());
    const totals = mstCell();
    let internal = 0;
    rows.forEach((r) => {
      if (!r.slot || !r.slot.starts_at) return;
      if (mstInternal(r.email)) { internal++; return; }
      const i = idx[mstBucket(group, mstParts(r.slot.starts_at)).key];
      if (i === undefined) return;
      const so = mstSource(r, leadSrc.get(r.compounder_lead_id));
      if (!bySrc[so.key]) bySrc[so.key] = Object.assign({ key: so.key, kind: so.kind, label: so.kind === 'sales' ? (pName.get(r.booked_by_person_id) || ('Obchodník #' + r.booked_by_person_id)) : so.kind === 'ads' ? 'Reklama' : 'Sám z webu / odkazu' }, mstCell());
      mstAdd(bySrc[so.key], r.status, r.slot.starts_at, now);
      if (!srcMatch(so)) return;
      mstAdd(cells[i], r.status, r.slot.starts_at, now);
      cells[i].by = cells[i].by || {}; cells[i].by[so.key] = (cells[i].by[so.key] || 0) + 1; // rozpad sloupce podle toho, kdo domluvil
      if (r.status === 'done') { cells[i].byDone = cells[i].byDone || {}; cells[i].byDone[so.key] = (cells[i].byDone[so.key] || 0) + 1; }
      mstAdd(totals, r.status, r.slot.starts_at, now);
    });
    // U dnu schovavame prazdne vikendy (schuzky se delaji v pracovnich dnech).
    // Jakmile na sobotu nebo nedeli neco pripadne, zustane videt - nic se neztrati.
    const out = buckets
      .map((b, i) => Object.assign({}, b, cells[i], { rate: mstRate(cells[i]) }))
      .filter((b) => !(group === 'day' && (b.dow === 0 || b.dow === 6) && !b.booked));
    res.json({
      group,
      n,
      fwd,
      buckets: out,
      totals: Object.assign({}, totals, { rate: mstRate(totals) }),
      internal_skipped: internal,
      src,
      // Rozpad podle zdroje za celé zobrazené období: souhrn Obchodníci + po obchodnících, Reklama, Sám z webu
      // Cíl: 25 domluvených online schůzek denně za celý tým — počítá se podle DATA DOMLUVENÍ (created_at), posledních 14 dní
      goal: await (async () => {
        const perDay = Math.max(1, parseInt(process.env.MEETINGS_DAILY_GOAL, 10) || 25);
        const since = new Date(Date.now() - 15 * 86400000);
        const gr = await prisma.meetingReservation.findMany({ where: { created_at: { gte: since }, OR: [{ mode: null }, { mode: { notIn: ['hala', 'hala_cont'] } }] }, select: { created_at: true, email: true, booked_by_person_id: true, compounder_lead_id: true } }).catch(() => []);
        const gl = [...new Set(gr.map((r) => r.compounder_lead_id).filter((x) => x && !leadSrc.has(x)))];
        if (gl.length) (await prisma.compounderLead.findMany({ where: { id: { in: gl } }, select: { id: true, source: true } }).catch(() => [])).forEach((l) => leadSrc.set(l.id, l.source || ''));
        const gp = [...new Set(gr.map((r) => r.booked_by_person_id).filter((x) => x && !pName.has(x)))];
        if (gp.length) (await prisma.person.findMany({ where: { id: { in: gp } }, select: { id: true, first_name: true, last_name: true } }).catch(() => [])).forEach((p) => pName.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(' ')));
        const days = {}; const nowP2 = mstParts(Date.now());
        for (let k = 13; k >= 0; k--) { const x = mstYmd(mstNoon(nowP2.y, nowP2.m, nowP2.d) - k * 86400000); const key = x.y + '-' + mst2(x.m) + '-' + mst2(x.d); days[key] = { date: key, dow: new Date(mstNoon(x.y, x.m, x.d)).getUTCDay(), total: 0, sales: 0, by: {} }; }
        gr.forEach((r) => {
          if (mstInternal(r.email)) return;
          const pp = mstParts(r.created_at); const key = pp.y + '-' + mst2(pp.m) + '-' + mst2(pp.d); const d = days[key]; if (!d) return;
          const so = mstSource(r, leadSrc.get(r.compounder_lead_id));
          d.total++; if (so.kind === 'sales') d.sales++; d.by[so.key] = (d.by[so.key] || 0) + 1;
        });
        const names = {}; gr.forEach((r) => { if (r.booked_by_person_id) names['p:' + r.booked_by_person_id] = pName.get(r.booked_by_person_id) || ('Obchodník #' + r.booked_by_person_id); });
        return { per_day: perDay, days: Object.values(days), names };
      })(),
      // Čas u telefonu: kolik času obchodníci strávili hovory — stejné okno jako cíl týmu (14 dní).
      // Délku měří aplikace obchodníka: od kliknutí na „Volat" po jeho další akci v appce, strop 15 min
      // (CompounderEvent event='sales_action', props.action='call', props.dur_min). Hovor, po kterém už
      // obchodník nic neudělal, délku ještě nemá — vracíme ho zvlášť jako „open", ať čísla nelžou.
      calls: await (async () => {
        const CAP = 15;
        const since = new Date(Date.now() - 15 * 86400000);
        const ev = await prisma.compounderEvent.findMany({
          where: { event: 'sales_action', created_at: { gte: since } },
          select: { props: true, created_at: true }, take: 50000,
        }).catch(() => []);
        const callEv = ev.filter((e) => e.props && e.props.action === 'call' && e.props.person_id);
        const cIds = [...new Set(callEv.map((e) => e.props.person_id).filter((x) => !pName.has(x)))];
        if (cIds.length) (await prisma.person.findMany({ where: { id: { in: cIds } }, select: { id: true, first_name: true, last_name: true } }).catch(() => [])).forEach((p) => pName.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(' ')));
        const nowP3 = mstParts(Date.now());
        const todayKey = nowP3.y + '-' + mst2(nowP3.m) + '-' + mst2(nowP3.d);
        const days = {};
        for (let k = 13; k >= 0; k--) {
          const x = mstYmd(mstNoon(nowP3.y, nowP3.m, nowP3.d) - k * 86400000);
          const key = x.y + '-' + mst2(x.m) + '-' + mst2(x.d);
          days[key] = { date: key, dow: new Date(mstNoon(x.y, x.m, x.d)).getUTCDay(), calls: 0, talk_min: 0, by: {} };
        }
        const people = {}, names = {};
        const pcell = () => ({ calls: 0, talk_min: 0, open: 0, today_calls: 0, today_talk_min: 0 });
        callEv.forEach((e) => {
          const pid = e.props.person_id, key = 'p:' + pid;
          const pp = mstParts(e.created_at), dk = pp.y + '-' + mst2(pp.m) + '-' + mst2(pp.d);
          const d = days[dk]; if (!d) return;
          const min = Math.max(0, Number(e.props.dur_min) || 0);
          names[key] = pName.get(pid) || ('Obchodník #' + pid);
          const p = people[key] || (people[key] = pcell());
          p.calls++; p.talk_min += min; if (!min) p.open++;
          if (dk === todayKey) { p.today_calls++; p.today_talk_min += min; }
          d.calls++; d.talk_min += min;
          const db = d.by[key] || (d.by[key] = { calls: 0, talk_min: 0 });
          db.calls++; db.talk_min += min;
        });
        const list = Object.keys(people).map((k) => {
          const p = people[k], measured = p.calls - p.open;
          return Object.assign({ key: k, name: names[k] }, p, { avg_min: measured > 0 ? Math.round((p.talk_min / measured) * 10) / 10 : null });
        });
        list.sort((a, b) => (b.talk_min - a.talk_min) || (b.calls - a.calls));
        const total = list.reduce((a, x) => { a.calls += x.calls; a.talk_min += x.talk_min; a.open += x.open; a.today_calls += x.today_calls; a.today_talk_min += x.today_talk_min; return a; }, pcell());
        const measuredT = total.calls - total.open;
        total.avg_min = measuredT > 0 ? Math.round((total.talk_min / measuredT) * 10) / 10 : null;
        return { cap_min: CAP, days: Object.values(days), people: list, total, names };
      })(),
      // Trychtýř: kontakty s online schůzkou v období → z nich schůzka na hale (kdykoli) → obchod (stav kontaktu)
      funnel: await (async () => {
        const WON = new Set(['won', 'prodano', 'converted']);
        const on = new Map(); rows.forEach((r) => { if (!r.compounder_lead_id || mstInternal(r.email) || r.status === 'canceled') return; const x = on.get(r.compounder_lead_id) || { done: false }; if (r.status === 'done') x.done = true; on.set(r.compounder_lead_id, x); });
        const ids = [...on.keys()];
        const hall = ids.length ? await prisma.meetingReservation.findMany({ where: { compounder_lead_id: { in: ids }, mode: 'hala', status: { not: 'canceled' } }, select: { compounder_lead_id: true, status: true } }).catch(() => []) : [];
        const hb = new Set(hall.map((h) => h.compounder_lead_id)), hd = new Set(hall.filter((h) => h.status === 'done').map((h) => h.compounder_lead_id));
        const won = ids.filter((id) => WON.has(leadStatus.get(id)));
        return { online_leads: ids.length, online_done: ids.filter((id) => on.get(id).done).length, hall_booked: hb.size, hall_done: hd.size, deals: won.length, deals_after_hall: won.filter((id) => hb.has(id)).length,
          hall_in_period: hallRows.length, hall_in_period_done: hallRows.filter((r) => r.status === 'done').length };
      })(),
      sources: (() => {
        const list = Object.values(bySrc);
        const sales = list.filter((x) => x.kind === 'sales');
        const sum = mstCell(); sales.forEach((x) => Object.keys(sum).forEach((k) => { sum[k] += x[k]; }));
        const withRate = (x) => Object.assign({}, x, { rate: mstRate(x) });
        const out = [];
        if (sales.length) out.push(withRate(Object.assign({ key: 'sales', kind: 'sales_total', label: 'Obchodníci celkem' }, sum)));
        sales.sort((a, b) => b.booked - a.booked).forEach((x) => out.push(withRate(x)));
        list.filter((x) => x.kind === 'ads').forEach((x) => out.push(withRate(x)));
        list.filter((x) => x.kind === 'self').forEach((x) => out.push(withRate(x)));
        // Barvy do grafu: každý obchodník vlastní, reklama modrá, sám z webu šedá
        const PAL = ['#ef4444', '#f59e0b', '#ec4899', '#22c55e', '#a855f7', '#f97316', '#eab308', '#14b8a6', '#84cc16', '#e879f9', '#fb7185', '#facc15']; // obchodníci — výrazné, ne modré (modrá = zákazník sám)
        const ids = out.filter((x) => x.kind === 'sales').map((x) => Number(String(x.key).slice(2))).sort((a, b) => a - b); // barva podle ID obchodníka = stabilní
        out.forEach((x) => { x.color = x.kind === 'ads' ? '#3b82f6' : x.kind === 'self' ? '#94a3b8' : x.kind === 'sales_total' ? '#c084fc' : PAL[ids.indexOf(Number(String(x.key).slice(2))) % PAL.length]; });
        return out;
      })(),
    });
  } catch (err) { next(err); }
});
// GET /api/auth/bs2/hot-leads — kontakty ručně označené jako „zajímavý kontakt"
// (CompounderLead.is_hot). Slouží jmennému seznamu v administraci Laundromats,
// aby obchodník viděl horké kontakty vedle kalendáře schůzek.
router.get('/bs2/hot-leads', async (req, res, next) => {
  try {
    if (!verifyMeetingsToken(req, res)) return;
    const leads = await prisma.compounderLead.findMany({
      where: { is_hot: true, is_test: { not: true } },
      orderBy: [{ last_called_at: 'desc' }, { created_at: 'desc' }],
      take: 500,
      select: {
        id: true, name: true, first_name: true, last_name: true, company: true, city: true,
        email: true, phone: true, status: true, lang: true, only_polish: true,
        created_at: true, last_called_at: true, owner_person_id: true,
      },
    });
    // Jméno obchodníka doplníme jedním dotazem (ne per kontakt).
    const ownerIds = [...new Set(leads.map((l) => l.owner_person_id).filter(Boolean))];
    const owners = ownerIds.length
      ? await prisma.person.findMany({ where: { id: { in: ownerIds } }, select: { id: true, first_name: true, last_name: true } }).catch(() => [])
      : [];
    const om = new Map(owners.map((o) => [o.id, [o.first_name, o.last_name].filter(Boolean).join(' ').trim()]));
    res.json(leads.map((l) => ({
      id: l.id,
      name: l.name || [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || l.email || l.phone || '—',
      company: l.company || null,
      city: l.city || null,
      email: l.email || null,
      phone: l.phone || null,
      status: l.status || 'new',
      only_polish: !!l.only_polish,
      lang: l.lang || null,
      created_at: l.created_at,
      last_called_at: l.last_called_at,
      owner: l.owner_person_id ? (om.get(l.owner_person_id) || null) : null,
    })));
  } catch (err) { next(err); }
});

router.post('/bs2/meetings/slots', express.json({ limit: '200kb' }), async (req, res, next) => {
  try {
    if (!verifyMeetingsToken(req, res)) return;
    const b = req.body || {};
    const items = (Array.isArray(b.slots) ? b.slots : [b]).slice(0, 500);
    const created = [];
    for (const it of items) {
      const d = it && it.starts_at ? new Date(it.starts_at) : null;
      if (!d || isNaN(d)) continue;
      const mode = ['online', 'osobne'].includes(it.mode) ? it.mode : null;
      const s = await prisma.meetingSlot.create({
        data: { starts_at: d, duration_min: Math.min(Math.max(parseInt(it.duration_min, 10) || 17, 5), 480), capacity: Math.min(Math.max(parseInt(it.capacity, 10) || 1, 1), 50), mode, note: it.note ? String(it.note).slice(0, 500) : null, active: it.active === false ? false : true },
        select: { id: true },
      });
      created.push(s.id);
    }
    res.status(201).json({ ok: true, created });
  } catch (err) { next(err); }
});
router.patch('/bs2/meetings/slots/:id(\\d+)', express.json({ limit: '20kb' }), async (req, res, next) => {
  try {
    if (!verifyMeetingsToken(req, res)) return;
    const b = req.body || {}, data = {};
    if (b.starts_at) { const d = new Date(b.starts_at); if (!isNaN(d)) data.starts_at = d; }
    if (b.duration_min != null) data.duration_min = Math.min(Math.max(parseInt(b.duration_min, 10) || 17, 5), 480);
    if (b.capacity != null) data.capacity = Math.min(Math.max(parseInt(b.capacity, 10) || 1, 1), 50);
    if (b.mode !== undefined) data.mode = ['online', 'osobne'].includes(b.mode) ? b.mode : null;
    if (b.note !== undefined) data.note = b.note ? String(b.note).slice(0, 500) : null;
    if (b.active !== undefined) data.active = !!b.active;
    await prisma.meetingSlot.update({ where: { id: parseInt(req.params.id, 10) }, data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
router.delete('/bs2/meetings/slots/:id(\\d+)', async (req, res, next) => {
  try {
    if (!verifyMeetingsToken(req, res)) return;
    const id = parseInt(req.params.id, 10);
    const booked = await prisma.meetingReservation.count({ where: { slot_id: id, status: 'booked' } });
    if (booked) return res.status(409).json({ ok: false, error: 'Termín má aktivní rezervaci — nejdřív ji zrušte, nebo termín jen vypněte.' });
    const any = await prisma.meetingReservation.count({ where: { slot_id: id } });
    if (any) { await prisma.meetingSlot.update({ where: { id }, data: { active: false } }); return res.json({ ok: true, deactivated: true }); } // historii rezervací nemažeme
    await prisma.meetingSlot.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
// POST /api/auth/bs2/leads/:id/hot {hot} — „Zajímavý kontakt" (CompounderLead.is_hot) z kalendáře schůzek Laundromats
router.post('/bs2/leads/:id(\\d+)/hot', express.json({ limit: '5kb' }), async (req, res, next) => {
  try {
    if (!verifyMeetingsToken(req, res)) return;
    const id = parseInt(req.params.id, 10);
    const lead = await prisma.compounderLead.findUnique({ where: { id }, select: { id: true, is_hot: true } });
    if (!lead) return res.status(404).json({ ok: false, error: 'Kontakt nenalezen' });
    const hot = (req.body && req.body.hot !== undefined) ? !!req.body.hot : !lead.is_hot;
    const upd = await prisma.compounderLead.update({ where: { id }, data: { is_hot: hot }, select: { id: true, is_hot: true } });
    res.json({ ok: true, is_hot: upd.is_hot });
  } catch (err) { next(err); }
});
router.patch('/bs2/meetings/reservations/:id(\\d+)', express.json({ limit: '20kb' }), async (req, res, next) => {
  try {
    if (!verifyMeetingsToken(req, res)) return;
    const b = req.body || {}, data = {};
    if (b.status !== undefined) { if (!BS2_RES_STATUSES.includes(b.status)) return res.status(400).json({ ok: false, error: 'Neplatný stav' }); data.status = b.status; }
    if (b.note !== undefined) data.note = b.note ? String(b.note).slice(0, 1000) : null;
    const rid = parseInt(req.params.id, 10);
    const prevRes = data.status === 'canceled' ? await prisma.meetingReservation.findUnique({ where: { id: rid }, select: { status: true } }).catch(() => null) : null;
    await prisma.meetingReservation.update({ where: { id: rid }, data });
    if (data.status === 'canceled' && prevRes && prevRes.status !== 'canceled') require('../services/meeting/notify').notifyMeetingCanceled(prisma, rid, { by: 'administrace' }).catch(() => {});
    res.json({ ok: true });
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

// ── Laundromats (laundromats.eu/pradlomaty): ceník strojů + fotky. Ověření JWT s VLASTNÍM tajemstvím LM_SSO_SECRET (iss laundromats).
function lmApiAuth(req, res) {
  const secret = process.env.LM_SSO_SECRET; const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!secret || !m) { res.status(401).json({ error: 'Neautorizováno' }); return false; }
  try { jwt.verify(m[1], secret, { audience: 'holyos-api', issuer: 'laundromats' }); return true; } catch (e) { res.status(401).json({ error: 'Neplatný token' }); return false; }
}
// Účty registrovaných uživatelů laundromats.eu (servisní JWT z Laundromats)
router.use('/lm/accounts', require('./lm-accounts.routes'));
// Videohovory z laundromats.eu/videocall (upozornění Jan + Tomáš, TURN servery)
router.use('/lm/vc', require('./lm-videocall.routes'));
router.use('/lm/support', require('./lm-support.routes'));
router.use('/lm/i18n', require('./lm-i18n.routes')); // automatický překlad nových textů laundromats.eu (EN/PL) // Podpora Laundromats (chat) — servisní API pro laundromats.eu
router.get('/lm/products', async (req, res, next) => {
  try {
    if (!lmApiAuth(req, res)) return;
    const items = await prisma.salesPricelistItem.findMany({
      where: { active: true, kind: 'machine' },
      orderBy: [{ model_version: 'asc' }, { model_variant: 'asc' }, { name_cs: 'asc' }],
      select: { id: true, name_cs: true, name_en: true, price_czk: true, price_eur: true, model_version: true, model_variant: true, machine_code: true, image_ext: true, image_updated_at: true },
    });
    const fsx = require('fs'), pathx = require('path'); const imgDir = pathx.join(__dirname, '..', 'data', 'pricelist-images');
    items.forEach((i) => { if (i.image_ext && !fsx.existsSync(pathx.join(imgDir, 'pl-' + i.id + '.' + i.image_ext))) { i.image_ext = null; i.image_updated_at = null; } });
    // vlastní obrázek pro laundromats.eu má přednost
    items.forEach((i) => { const own = lmOwnImage(i.id); if (own) { i.image_ext = own.ext; i.image_updated_at = new Date(own.mtime); i.lm_image = true; } });
    res.json(items.map((i) => ({ ...i, price_czk: i.price_czk == null ? null : Number(i.price_czk), price_eur: i.price_eur == null ? null : Number(i.price_eur) })));
  } catch (err) { next(err); }
});
// ── Nastavení produktů pro laundromats.eu (administrace Laundromats → Produkty) ──
// AppSetting `laundromats.products`: { show_prices, items: { [id]: { hidden, order, title, desc, show_price } } }
// Vlastní obrázek pro web: data/lm-product-images/lm-<id>.<ext> (má přednost před obrázkem z ceníku).
const LM_PROD_KEY = 'laundromats.products';
const LM_IMG_DIR = () => require('path').join(__dirname, '..', 'data', 'lm-product-images');
const LM_IMG_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
function lmOwnImage(id) { const fs = require('fs'), path = require('path'); for (const e of ['webp', 'png', 'jpg']) { const f = path.join(LM_IMG_DIR(), 'lm-' + id + '.' + e); if (fs.existsSync(f)) return { file: f, ext: e, mtime: fs.statSync(f).mtimeMs }; } return null; }
router.get('/lm/products-config', async (req, res, next) => {
  try {
    if (!lmApiAuth(req, res)) return;
    const { getSetting } = require('../services/settings');
    const cfg = (await getSetting(LM_PROD_KEY, { type: 'json', defaultValue: null }).catch(() => null)) || { show_prices: false, items: {} };
    res.json({ ok: true, config: cfg });
  } catch (err) { next(err); }
});
router.put('/lm/products-config', express.json({ limit: '200kb' }), async (req, res, next) => {
  try {
    if (!lmApiAuth(req, res)) return;
    const b = (req.body && req.body.config) || {};
    const items = {};
    Object.entries(b.items || {}).slice(0, 500).forEach(([id, v]) => {
      if (!/^\d+$/.test(id) || !v || typeof v !== 'object') return;
      items[id] = { hidden: !!v.hidden, order: Number.isFinite(+v.order) ? Math.round(+v.order) : 0, title: String(v.title || '').trim().slice(0, 120), desc: String(v.desc || '').trim().slice(0, 600), show_price: v.show_price === true ? true : v.show_price === false ? false : null };
    });
    const cfg = { show_prices: !!b.show_prices, items };
    const { setSetting } = require('../services/settings');
    await setSetting(LM_PROD_KEY, cfg, { type: 'json', description: 'Laundromats.eu — produkty na stránce Prádlomaty (viditelnost, pořadí, texty, ceny)', scope: 'laundromats' });
    res.json({ ok: true, config: cfg });
  } catch (err) { next(err); }
});
// POST /lm/products/:id/lm-image {data: base64, mime} | DELETE — vlastní obrázek produktu pro web
router.post('/lm/products/:id/lm-image', async (req, res, next) => {
  try {
    if (!lmApiAuth(req, res)) return;
    const fs = require('fs'), path = require('path'); const id = parseInt(req.params.id, 10);
    const ext = LM_IMG_EXT[String((req.body || {}).mime || '')]; if (!ext) return res.status(400).json({ error: 'Obrázek musí být PNG, JPG nebo WebP' });
    const buf = Buffer.from(String((req.body || {}).data || ''), 'base64'); if (!buf.length || buf.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'Obrázek je prázdný nebo větší než 8 MB' });
    fs.mkdirSync(LM_IMG_DIR(), { recursive: true });
    for (const e of ['webp', 'png', 'jpg']) { const f = path.join(LM_IMG_DIR(), 'lm-' + id + '.' + e); if (fs.existsSync(f)) fs.unlinkSync(f); }
    fs.writeFileSync(path.join(LM_IMG_DIR(), 'lm-' + id + '.' + ext), buf);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
router.delete('/lm/products/:id/lm-image', async (req, res, next) => {
  try {
    if (!lmApiAuth(req, res)) return;
    const fs = require('fs'), path = require('path'); const id = parseInt(req.params.id, 10);
    for (const e of ['webp', 'png', 'jpg']) { const f = path.join(LM_IMG_DIR(), 'lm-' + id + '.' + e); if (fs.existsSync(f)) fs.unlinkSync(f); }
    res.json({ ok: true });
  } catch (err) { next(err); }
});
router.get('/lm/products/:id/image', async (req, res, next) => {
  try {
    if (!lmApiAuth(req, res)) return;
    const fs = require('fs'), path = require('path'); const id = parseInt(req.params.id, 10);
    const own = lmOwnImage(id);
    if (own) { res.set('Content-Type', { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[own.ext]).set('Cache-Control', 'public, max-age=3600'); return fs.createReadStream(own.file).pipe(res); }
    const it = await prisma.salesPricelistItem.findUnique({ where: { id }, select: { image_ext: true } });
    if (!it || !it.image_ext) return res.status(404).json({ error: 'Bez obrázku' });
    const file = path.join(__dirname, '..', 'data', 'pricelist-images', `pl-${id}.${it.image_ext}`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Soubor chybí' });
    res.set('Content-Type', { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[it.image_ext] || 'application/octet-stream').set('Cache-Control', 'public, max-age=3600');
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
    // Změna hesla nebo role → všechny dříve vydané tokeny uživatele přestanou platit
    if (password || role !== undefined || isSuperAdmin !== undefined) data.token_version = { increment: 1 };

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
module.exports.bs2Allowed = bs2Allowed;
