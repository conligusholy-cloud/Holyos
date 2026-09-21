// =============================================================================
// HolyOS — Globální vyhledávání (okno CTRL+PAUSE)
// -----------------------------------------------------------------------------
// Jeden endpoint, který hledá napříč daty systému. Statický katalog modulů,
// stránek a formulářů si drží frontend (js/global-search.js) — ten se nemění
// za běhu a nemá smysl kvůli němu chodit na server. Tady hledáme jen to, co
// žije v databázi:
//   • zboží     — Material (kód, název, čárový kód, klíčová slova)
//   • výrobky   — Product (kód, název)
//   • činnosti  — ProductOperation (název operace, fáze)
//
// Výsledky filtrujeme podle oprávnění uživatele (allowed_modules, stejná
// logika jako /api/auth/me) — co uživatel nevidí v sidebaru, to mu hledání
// nenabídne.
// =============================================================================

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// ─── Validace ──────────────────────────────────────────────────────────────

const querySchema = z.object({
  q: z.string().trim().min(2).max(100),
  limit: z.coerce.number().int().min(1).max(30).optional(),
});

// ─── Oprávnění ─────────────────────────────────────────────────────────────

// Vrátí mapu module_id → access_level, nebo null když uživatel vidí vše
// (admin / super admin). Shodné chování s GET /api/auth/me.
async function loadAllowedModules(user) {
  if (user.isSuperAdmin || user.role === 'admin') return null;

  const person = await prisma.person.findFirst({
    where: { user_id: user.id },
    include: { role: { include: { permissions: true } } },
  });

  const perms = (person && person.role && person.role.permissions) || [];
  const map = {};
  for (const p of perms) {
    if (p.access_level && p.access_level !== 'none') map[p.module_id] = p.access_level;
  }
  return map;
}

// Vidí uživatel alespoň jeden z modulů, do kterých výsledek vede?
function canSee(allowed, moduleIds) {
  if (allowed === null) return true;
  return moduleIds.some((id) => !!allowed[id]);
}

// ─── Skóre ─────────────────────────────────────────────────────────────────

// Shoda od začátku řetězce je cennější než shoda uprostřed, kratší název
// (= přesnější trefa) je cennější než dlouhý. Nižší číslo = výš v seznamu.
function score(text, needle) {
  const t = String(text || '').toLowerCase();
  const n = needle.toLowerCase();
  const idx = t.indexOf(n);
  if (idx < 0) return 1000;
  return (idx === 0 ? 0 : 100) + Math.min(idx, 50) + Math.min(t.length / 20, 20);
}

// ─── Routes ────────────────────────────────────────────────────────────────

// GET /api/search?q=prac&limit=8 — hledání v datech systému
router.get('/', async (req, res, next) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      // Krátký nebo chybějící dotaz není chyba — jen nic nenajde.
      return res.json({ q: String(req.query.q || ''), items: [] });
    }

    const q = parsed.data.q;
    const limit = parsed.data.limit || 8;
    const allowed = await loadAllowedModules(req.user);

    const wantsGoods = canSee(allowed, ['nakup-sklad', 'sklady', 'doklady', 'davky']);
    const wantsProduction = canSee(allowed, ['pracovni-postup', 'normovani-prehled', 'planovani-vyroby']);

    const [materials, products, operations] = await Promise.all([
      wantsGoods
        ? prisma.material.findMany({
            where: {
              status: { not: 'deleted' },
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { code: { contains: q, mode: 'insensitive' } },
                { barcode: { contains: q, mode: 'insensitive' } },
                { keywords: { contains: q, mode: 'insensitive' } },
              ],
            },
            select: { id: true, code: true, name: true, type: true, unit: true, current_stock: true },
            take: limit * 3,
            orderBy: { name: 'asc' },
          })
        : Promise.resolve([]),

      wantsProduction
        ? prisma.product.findMany({
            where: {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { code: { contains: q, mode: 'insensitive' } },
              ],
            },
            select: { id: true, code: true, name: true, type: true },
            take: limit * 3,
            orderBy: { name: 'asc' },
          })
        : Promise.resolve([]),

      wantsProduction
        ? prisma.productOperation.findMany({
            where: {
              is_staging: false,
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { phase: { contains: q, mode: 'insensitive' } },
              ],
            },
            select: {
              id: true,
              name: true,
              phase: true,
              step_number: true,
              product: { select: { id: true, code: true, name: true } },
            },
            take: limit * 3,
            orderBy: { name: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    const MAT_TYPES = { material: 'Materiál', product: 'Výrobek', goods: 'Zboží', semi_product: 'Polotovar' };

    const items = [];

    for (const m of materials) {
      items.push({
        kind: 'zbozi',
        kindLabel: MAT_TYPES[m.type] || 'Zboží',
        icon: '📦',
        title: m.name,
        subtitle: m.code + (m.current_stock != null ? ' · skladem ' + Number(m.current_stock) + ' ' + (m.unit || '') : ''),
        // Cílová stránka nemá vlastní detail zboží — otevřeme záložku Zboží
        // a předvyplníme hledání kódem (viz deep-link v js/global-search.js).
        url: '/modules/nakup-sklad/index.html',
        deep: { tab: 'materials', field: 'mat-search', value: m.code },
        module: 'nakup-sklad',
        _score: Math.min(score(m.name, q), score(m.code, q)),
      });
    }

    for (const p of products) {
      items.push({
        kind: 'vyrobek',
        kindLabel: p.type === 'semi-product' ? 'Polotovar' : 'Výrobek',
        icon: '🏭',
        title: p.name,
        subtitle: p.code + ' · pracovní postup',
        url: '/modules/pracovni-postup/detail.html?id=' + p.id,
        module: 'pracovni-postup',
        _score: Math.min(score(p.name, q), score(p.code, q)),
      });
    }

    for (const o of operations) {
      if (!o.product) continue;
      items.push({
        kind: 'cinnost',
        kindLabel: 'Činnost',
        icon: '🔧',
        title: o.name,
        subtitle: (o.phase ? o.phase + ' · ' : '') + o.product.name + ' (' + o.product.code + ')',
        url: '/modules/pracovni-postup/detail.html?id=' + o.product.id,
        module: 'pracovni-postup',
        _score: Math.min(score(o.name, q), score(o.phase, q)) + 5, // operace až za výrobky
      });
    }

    items.sort((a, b) => a._score - b._score || a.title.localeCompare(b.title, 'cs'));

    res.json({
      q,
      items: items.slice(0, limit * 3).map((it) => {
        const { _score, ...rest } = it;
        return rest;
      }),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
