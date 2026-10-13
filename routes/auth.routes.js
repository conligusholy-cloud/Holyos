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
    const preferred = process.env.BS2_MAIL_FROM || 'info@pradlomaty.info';
    const fallback = process.env.SERVICE_BILLING_MAIL_FROM || (our && our.email) || process.env.COMPOUNDER_MAIL_FROM || undefined;
    const mailer = require('../services/email');
    const base2 = { to, brand: 'bs2', fromName: process.env.BS2_MAIL_FROM_NAME || 'Best Series 2.0', subject: String(b.subject || 'Best Series 2.0').slice(0, 200), body: String(b.body || '').slice(0, 5000), link, linkLabel: b.linkLabel ? String(b.linkLabel).slice(0, 80) : undefined };
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
    for (const p of persons) {
      notifyPerson(prisma, p.id, { title, body, data: { type: 'bs2_' + type, link }, sound: 'default' }).catch((e) => console.warn('[bs2 notify] push', p.id, e.message));
      if (p.user_id) createNotification({ userId: p.user_id, type: 'system', title, body, link }).catch((e) => console.warn('[bs2 notify] zvonek', p.user_id, e.message));
    }
    res.json({ ok: true, recipients: persons.length });
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
