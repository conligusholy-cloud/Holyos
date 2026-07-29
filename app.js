// =============================================================================
// HolyOS — Express aplikace (hlavní soubor)
// =============================================================================

// `override: true` zaručuje, že hodnoty z .env přepíší shell-level env variables
// (typicky Win User-level Environment, kde někdy zbývají placeholder hodnoty).
// Na Railway/produkci .env soubor neexistuje, takže dotenv neudělá nic — env z
// platformy zůstane respektované. Viz holyos_env_powershell_shadow memory.
require('dotenv').config({ override: true });

// Global safety net — nechceme, aby osamocený unhandled error (např. síťový
// ECONNRESET z IMAP socketu) zabil celý HolyOS server. Logujeme, ale žijeme dál.
process.on('uncaughtException', (err, origin) => {
  console.error(`[app] uncaughtException (${origin}):`, err.message || err, err.stack);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[app] unhandledRejection:', reason);
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');

const { errorHandler } = require('./middleware/error-handler');
const { prisma } = require('./config/database');

// ─── Import routes ─────────────────────────────────────────────────────────

const authRoutes = require('./routes/auth.routes');
const hrRoutes = require('./routes/hr.routes');
const applicantsRoutes = require('./routes/applicants.routes');
const warehouseRoutes = require('./routes/warehouse.routes');
const warehouseV2Routes = require('./routes/warehouse-v2.routes');
const mindmapRoutes = require('./routes/mindmap.routes');
const adminTasksRoutes = require('./routes/admin-tasks.routes');
const auditRoutes = require('./routes/audit.routes');
const aiRoutes = require('./routes/ai.routes');
const storageRoutes = require('./routes/storage.routes');
const voiceRoutes = require('./routes/voice.routes');
const chatRoutes = require('./routes/chat.routes');
const productionRoutes = require('./routes/production.routes');
const planningRoutes = require('./routes/planning.routes');
const slotsRoutes = require('./routes/slots.routes');
const slotSchemesRoutes = require('./routes/slot-schemes.routes');
const devRoutes = require('./routes/dev.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const messagesRoutes = require('./routes/messages.routes');
const fleetRoutes = require('./routes/fleet.routes');
const cadRoutes = require('./routes/cad.routes');
const printRoutes = require('./routes/print.routes');
const accountingRoutes = require('./routes/accounting.routes');
const bankingRoutes = require('./routes/banking.routes');
const cashRegisterRoutes = require('./routes/cash-register.routes');
const reportsRoutes = require('./routes/reports.routes');
const normovaniRoutes = require('./routes/normovani.routes');
const directivesRoutes = require('./routes/directives.routes');
const agentRoutes = require('./routes/agent.routes');
const businessToolsRoutes = require('./routes/business-tools.routes');
const siteDevelopmentRoutes = require('./routes/site-development.routes');
const salesRoutes = require('./routes/sales.routes');
const serviceRoutes = require('./routes/service.routes');
const hugoRoutes = require('./routes/hugo.routes');
const velinRoutes = require('./routes/velin.routes');
const eshopAdminRoutes = require('./routes/eshop-admin.routes');
const shopRoutes = require('./routes/shop.routes');
const shippingRoutes = require('./routes/shipping.routes');
const compounderRoutes = require('./routes/compounder.routes');

// ─── Inicializace aplikace ────────────────────────────────────────────────

const app = express();

// ─── Middleware ─────────────────────────────────────────────────────────────

// Bezpečnost
app.use(helmet({
  contentSecurityPolicy: false, // Povolit inline skripty pro stávající frontend
}));

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true,
}));

// Parsování
app.use((req, res, next) => {
  // Přeskočit JSON parsing pro /api/ai/transcribe (potřebuje raw multipart body)
  if (req.path === '/api/ai/transcribe') return next();
  express.json({ limit: '50mb' })(req, res, next);
});
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── Sales gate ────────────────────────────────────────────────────────────
// "Sales-only" uživatel (obchodník/vedoucí bez HolyOS práv) se dostane JEN na svou
// obrazovku + /api/auth a /api/compounder. Admin/super-admin NIKDY dotčen.
// Nouzový vypínač: env SALES_GATE_OFF=1.
const { peekToken } = require('./middleware/auth');
function salesGateAllowed(pathname) {
  if (pathname === '/api/health' || pathname === '/favicon.ico') return true;
  if (pathname.startsWith('/api/auth') || pathname.startsWith('/api/compounder') || pathname.startsWith('/api/sales') || pathname.startsWith('/api/lokality')) return true;
  // Obchodník — nabídky lokalit: jen vlastní (/api/sites/my) a konkrétní lokalita
  // podle id (detail, změna stavu/poznámky, aktivity). NE celý seznam /api/sites.
  if (pathname === '/api/sites/my') return true;
  if (/^\/api\/sites\/\d+(\/communications)?$/.test(pathname)) return true;
  if (pathname.startsWith('/modules/obchodnik') || pathname.startsWith('/modules/vedouci-obchodu') || pathname.startsWith('/modules/podpis-smlouvy')) return true;
  if (pathname === '/login.html' || pathname.startsWith('/login')) return true;
  if (pathname.startsWith('/css/') || pathname.startsWith('/js/') || pathname.startsWith('/dist/')) return true;
  if (/\.(css|js|mjs|png|jpe?g|gif|svg|ico|webp|webmanifest|woff2?|ttf|map)$/i.test(pathname)) return true;
  return false;
}
app.use((req, res, next) => {
  if (process.env.SALES_GATE_OFF === '1') return next();
  const p = peekToken(req);
  if (!p || !p.sales_only) return next();
  if (salesGateAllowed(req.path)) return next();
  if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Přístup jen pro obchodní obrazovku.' });
  return res.redirect(302, p.sales_home || '/modules/obchodnik/index.html');
});

// Logování requestů (development)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (req.path.startsWith('/api/')) {
        console.log(`${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
      }
    });
    next();
  });
}

// ─── Public Routes (bez autentizace) ───────────────────────────────────────

// Helper — public odkaz je aktivní jen když je objednávka v "new".
// Ve všech ostatních stavech vracíme 410 Gone se srozumitelným textem
// pro konfigurátor (order-view.html zobrazí hezkou chybovou stránku).
function orderLinkLocked(order) {
  // Nový = aktivní odkaz. Cokoliv jiného = zamčeno.
  return !order || order.status !== 'new';
}
function sendOrderLocked(res, order) {
  const statusLabel = {
    new: 'Nový', quoted: 'Poptáno', ordered: 'Objednáno',
    confirmed: 'Potvrzeno', delivered: 'Doručeno', cancelled: 'Zrušeno',
  }[order?.status] || order?.status || 'neznámý';
  return res.status(410).json({
    error: `Tento odkaz už není aktivní. Objednávka je ve stavu "${statusLabel}" — konfiguraci už nelze měnit.`,
    locked: true,
    status: order?.status || null,
  });
}

// Veřejný náhled objednávky pro zákazníka (bez autentizace)
app.get('/api/public/order/:token', async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { share_token: req.params.token },
      include: {
        company: { select: { name: true } },
        items: {
          include: {
            configs: {
              include: {
                option: {
                  include: { group: true },
                },
              },
            },
          },
        },
      },
    });
    if (!order) return res.status(404).json({ error: 'Objednávka nenalezena' });
    if (orderLinkLocked(order)) return sendOrderLocked(res, order);
    if (orderLinkLocked(order)) return sendOrderLocked(res, order);

    // Pro každou položku s product_id načti konfigurační skupiny a volby
    const itemsWithConfig = await Promise.all(order.items.map(async (it) => {
      let config_groups = [];
      if (it.product_id) {
        try {
          config_groups = await prisma.productConfigGroup.findMany({
            where: { product_id: it.product_id },
            orderBy: { sort_order: 'asc' },
            include: {
              options: {
                orderBy: { sort_order: 'asc' },
                select: {
                  id: true,
                  name: true,
                  code: true,
                  price_modifier: true,
                  is_default: true,
                  sort_order: true,
                },
              },
            },
          });
        } catch (e) {
          console.error('Chyba načítání konfigurace produktu:', e);
        }
      }
      return {
        id: it.id,
        name: it.name,
        product_id: it.product_id,
        quantity: it.quantity,
        unit: it.unit,
        unit_price: it.unit_price,
        total_price: it.total_price,
        configs: it.configs.map(c => ({
          group_name: c.option?.group?.name || '',
          option_name: c.option?.name || '',
          option_id: c.option_id,
          custom_value: c.custom_value,
        })),
        config_groups: config_groups.map(g => ({
          id: g.id,
          name: g.name,
          code: g.code,
          type: g.type,
          required: g.required,
          options: g.options.map(o => ({
            id: o.id,
            name: o.name,
            code: o.code,
            price_modifier: o.price_modifier,
            is_default: o.is_default,
          })),
        })),
      };
    }));

    // Vrať bezpečná data + konfiguraci pro zákaznický konfigurátor
    res.json({
      order_number: order.order_number,
      company_name: order.company?.name || '—',
      status: order.status,
      currency: order.currency,
      total_amount: order.total_amount,
      expected_delivery: order.expected_delivery,
      note: order.note,
      items: itemsWithConfig,
    });
  } catch (err) {
    console.error('Chyba veřejného náhledu:', err);
    res.status(500).json({ error: 'Interní chyba serveru' });
  }
});

// Zákazník potvrdí svoji konfiguraci (veřejné, bez auth)
app.post('/api/public/order/:token/configure', async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { share_token: req.params.token },
      include: { items: true },
    });
    if (!order) return res.status(404).json({ error: 'Objednávka nenalezena' });
    if (orderLinkLocked(order)) return sendOrderLocked(res, order);

    // Přijímáme: { items: [ { item_id: 1, selections: [ { group_id: 5, option_id: 12, custom_value: null }, ... ] }, ... ], customer_note: "..." }
    const { items: itemConfigs, customer_note } = req.body;

    if (!itemConfigs || !Array.isArray(itemConfigs)) {
      return res.status(400).json({ error: 'Chybí konfigurace položek' });
    }

    // Validuj, že všechny item_id patří k této objednávce
    const orderItemIds = new Set(order.items.map(i => i.id));
    for (const ic of itemConfigs) {
      if (!orderItemIds.has(ic.item_id)) {
        return res.status(400).json({ error: `Položka ${ic.item_id} nepatří k této objednávce` });
      }
    }

    // Ulož konfigurace v transakci
    await prisma.$transaction(async (tx) => {
      for (const ic of itemConfigs) {
        // Smaž staré konfigurace pro tuto položku
        await tx.orderItemConfig.deleteMany({
          where: { order_item_id: ic.item_id },
        });

        // Vlož nové
        if (ic.selections && ic.selections.length > 0) {
          await tx.orderItemConfig.createMany({
            data: ic.selections.map(s => ({
              order_item_id: ic.item_id,
              option_id: s.option_id || null,
              custom_value: s.custom_value || null,
            })),
          });
        }
      }

      // Aktualizuj poznámku zákazníka a stav na "ordered" (zákazník potvrdil konfiguraci)
      const updateData = {};
      if (customer_note) updateData.note = customer_note;
      if (order.status === 'new' || order.status === 'quoted') updateData.status = 'ordered';

      if (Object.keys(updateData).length > 0) {
        await tx.order.update({
          where: { id: order.id },
          data: updateData,
        });
      }
    });

    res.json({ ok: true, message: 'Konfigurace uložena. Děkujeme!' });
  } catch (err) {
    console.error('Chyba ukládání konfigurace:', err);
    res.status(500).json({ error: 'Interní chyba serveru' });
  }
});

// Veřejné API — volné výrobní sloty pro zákazníka
app.get('/api/public/order/:token/slots', async (req, res) => {
  try {
    const order = await prisma.order.findUnique({ where: { share_token: req.params.token } });
    if (!order) return res.status(404).json({ error: 'Objednávka nenalezena' });
    if (orderLinkLocked(order)) return sendOrderLocked(res, order);

    // Načti všechny existující sloty
    const slots = await prisma.productionSlot.findMany({
      include: { assignments: { select: { id: true, order_item_id: true, order_id: true } } },
      orderBy: { start_date: 'asc' },
    });

    // Vrať DB sloty + info pro matchování s generovanými okny
    res.json({
      config: { startDay: 1, endDay: 5 }, // Po–Pá (globální default)
      db_slots: slots.map(s => ({
        id: s.id,
        start_date: s.start_date,
        end_date: s.end_date,
        status: s.status,
        has_assignments: s.assignments && s.assignments.length > 0,
        is_blocked: s.status === 'blocked',
        my_assignment: s.assignments.find(a => a.order_id === order.id) || null,
      })),
      order_id: order.id,
    });
  } catch (err) {
    console.error('Chyba načítání slotů:', err);
    res.status(500).json({ error: 'Interní chyba serveru' });
  }
});

// Veřejné API — zákazník si vybere slot pro položku
app.post('/api/public/order/:token/select-slot', async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { share_token: req.params.token },
      include: { items: true, company: { select: { name: true } } },
    });
    if (!order) return res.status(404).json({ error: 'Objednávka nenalezena' });
    if (orderLinkLocked(order)) return sendOrderLocked(res, order);

    const { item_id, slot_id, start_date, end_date } = req.body;
    if (!item_id) return res.status(400).json({ error: 'Chybí item_id' });

    // Ověř že položka patří k objednávce
    const item = order.items.find(i => i.id === item_id);
    if (!item) return res.status(400).json({ error: 'Položka nepatří k této objednávce' });

    let actualSlotId = slot_id;

    if (slot_id) {
      // Slot existuje v DB — ověř že je volný
      const slot = await prisma.productionSlot.findUnique({
        where: { id: slot_id },
        include: { assignments: true },
      });
      if (!slot || slot.status === 'blocked' || (slot.assignments && slot.assignments.length > 0)) {
        return res.status(400).json({ error: 'Tento termín již není dostupný' });
      }
    } else if (start_date && end_date) {
      // Slot neexistuje v DB — vytvoř ho automaticky (generované okno)
      const sd = new Date(start_date), ed = new Date(end_date);
      const newSlot = await prisma.productionSlot.create({
        data: {
          name: 'Slot ' + sd.getDate() + '.' + (sd.getMonth()+1) + '.–' + ed.getDate() + '.' + (ed.getMonth()+1) + '.',
          start_date: sd,
          end_date: ed,
          capacity_hours: 8,
          status: 'open',
          color: '#3b82f6',
        },
      });
      actualSlotId = newSlot.id;
    } else {
      return res.status(400).json({ error: 'Chybí slot_id nebo start_date/end_date' });
    }

    // Vytvoř přiřazení
    await prisma.slotAssignment.create({
      data: {
        slot_id: actualSlotId,
        order_item_id: item_id,
        order_id: order.id,
        product_name: item.name || 'Položka',
        customer_name: order.company?.name || '',
        quantity: parseFloat(item.quantity) || 1,
        estimated_hours: 0,
        priority: 0,
        status: 'planned',
      },
    });

    // Označ slot jako full
    await prisma.productionSlot.update({ where: { id: actualSlotId }, data: { status: 'full' } });

    // Aktualizuj expected_delivery na objednávce (nejpozdější slot)
    const allAssignments = await prisma.slotAssignment.findMany({
      where: { order_id: order.id },
      include: { slot: { select: { end_date: true } } },
    });
    let latest = null;
    allAssignments.forEach(a => {
      if (a.slot && a.slot.end_date) {
        const d = new Date(a.slot.end_date);
        if (!latest || d > latest) latest = d;
      }
    });
    if (latest) {
      await prisma.order.update({ where: { id: order.id }, data: { expected_delivery: latest } });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Chyba výběru slotu:', err);
    res.status(500).json({ error: 'Interní chyba serveru' });
  }
});

// Veřejné API — zákazník odstraní slot z položky
app.post('/api/public/order/:token/remove-slot', async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { share_token: req.params.token },
      include: { items: true },
    });
    if (!order) return res.status(404).json({ error: 'Objednávka nenalezena' });
    if (orderLinkLocked(order)) return sendOrderLocked(res, order);

    const { item_id } = req.body;
    if (!item_id) return res.status(400).json({ error: 'Chybí item_id' });

    // Najdi přiřazení pro tuto položku
    const assignment = await prisma.slotAssignment.findFirst({
      where: { order_item_id: item_id, order_id: order.id },
    });
    if (!assignment) return res.status(404).json({ error: 'Přiřazení nenalezeno' });

    // Smaž přiřazení a vrať slot na open (pokud nemá další přiřazení)
    const slotId = assignment.slot_id;
    await prisma.slotAssignment.delete({ where: { id: assignment.id } });
    const remaining = await prisma.slotAssignment.count({ where: { slot_id: slotId } });
    if (remaining === 0) {
      await prisma.productionSlot.update({ where: { id: slotId }, data: { status: 'open' } });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Chyba odstraňování slotu:', err);
    res.status(500).json({ error: 'Interní chyba serveru' });
  }
});

// Veřejná stránka pro prohlížení objednávky
app.get('/order/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'order-view.html'));
});

// Veřejná stránka pro sdílené obchodní pomůcky (token-based, bez auth)
app.get('/share/tools/:tool/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tool-share.html'));
});

// Veřejná stránka pro vyplnění hlavičky smlouvy protistranou (token-based, bez auth)
app.get('/smlouva/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'contract-fill.html'));
});

// Veřejná zásady ochrany osobních údajů (vyžaduje Apple App Store / TestFlight review)
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

// Hugo — AI servisák pro partnery (mountnuté na bestseries.cash/hugo).
// Stránka má vlastní mobile-first UI, žádný HolyOS sidebar/topbar.
// SPA-like routing: /hugo, /hugo/login, /hugo/chat → vždy index.html, klient pak řeší tab.
// HTML servírujeme s no-cache, ať browser vždy vidí aktuální ?v= cache-bust query
// na script tagy. JS soubory si pak cachovat může — query string je sám invaliduje.
function serveHugoHtml(req, res) {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'hugo', 'index.html'));
}
app.get('/hugo', serveHugoHtml);
app.get('/hugo/', serveHugoHtml);

// Spare Parts Shop — partner-facing eshop náhradních dílů na bestseries.cash/spare-parts.
// Stejný princip jako Hugo: SPA HTML pro libovolnou cestu pod /spare-parts/*.
function serveSparePartsHtml(req, res) {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'spare-parts', 'index.html'));
}
app.get('/spare-parts', serveSparePartsHtml);
app.get('/spare-parts/', serveSparePartsHtml);
app.get('/spare-parts/app.js', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.sendFile(path.join(__dirname, 'public', 'spare-parts', 'app.js'));
});
app.get(/^\/spare-parts\/(?!app\.js).*$/, serveSparePartsHtml);

// Portál externího obchodníka — přihlášení vlastním tokenem (external-reps/login).
function serveObchodnikExt(req, res) {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'obchodnik-ext', 'index.html'));
}
app.get('/obchodnik-ext', serveObchodnikExt);
app.get('/obchodnik-ext/', serveObchodnikExt);

// ─── API Routes ────────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/hr/applicants', applicantsRoutes); // musí být PŘED /api/hr (pevný podcesta)
app.use('/api/hr', hrRoutes);
app.use('/api/wh', warehouseRoutes);
app.use('/api/wh', warehouseV2Routes); // Sklad 2.0 — moves, lookup, sync (mountnuté za legacy)
app.use('/api/mindmap', mindmapRoutes);
app.use('/api/admin-tasks', adminTasksRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/ai', voiceRoutes);  // stt-check, transcribe, voice (bez auth)
app.use('/api/ai', chatRoutes);   // chat endpoint (bez auth — pro panel)
app.use('/api/ai', aiRoutes);     // asistenti, konverzace (s auth)
app.use('/api/storage', storageRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/planning', planningRoutes);
app.use('/api/slots', slotsRoutes);
app.use('/api/slot-schemes', slotSchemesRoutes);
app.use('/api/dev', devRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/fleet', fleetRoutes);
app.use('/api/cad', cadRoutes);
app.use('/api/print', printRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/banking', bankingRoutes);
app.use('/api/cash', cashRegisterRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/normovani', normovaniRoutes);
app.use('/api/directives', directivesRoutes);
app.use('/api/agent', agentRoutes); // AI Vývojář (modul #13) — super-admin only
app.use('/api/tools', businessToolsRoutes); // Obchodní pomůcky (sales-aid)
app.use('/api/sales', salesRoutes); // Obchod — CRM (SalesContact, pipeline, kalendář, webhooky FB/IG/LinkedIn)
app.use('/api/sites', siteDevelopmentRoutes); // Site Development — řízení expanze (vyhledávání lokalit, pozemků, smluv)
app.use('/api/service', serviceRoutes); // Servis — interní admin (znalostní báze pro servisáky)
app.use('/api/hugo', hugoRoutes);        // Hugo AI servisák — partner login + chat (bestseries.cash)
app.use('/api/velin', velinRoutes); // Velín — mobilní aplikace pro řízení dne kolegů
app.use('/api/eshop-admin', eshopAdminRoutes); // Spare Parts Shop — admin CRUD (interní login)
app.use('/api/shop', shopRoutes); // Spare Parts Shop — partner-facing API (bestseries.cash)
app.use('/api/shipping', shippingRoutes); // Doprava — agenda požadavků na dopravu (interní login)
app.use('/api/compounder', compounderRoutes); // Compounder — veřejný web compounder.world (registrace leadů, analytika, push)
app.use('/api/lokality', require('./routes/lokality-public.routes')); // Lokality — veřejný web bestseries.global (nabídka místa pro prádlomat)

// ─── Legacy storage proxy (kompatibilita s persistent-storage.js) ──────────

const fs = require('fs');
const LEGACY_STORAGE_DIR = path.join(__dirname, 'data', 'storage');
if (!fs.existsSync(LEGACY_STORAGE_DIR)) {
  fs.mkdirSync(LEGACY_STORAGE_DIR, { recursive: true });
}

app.get('/storage/:key', (req, res) => {
  const key = req.params.key.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(LEGACY_STORAGE_DIR, key + '.json');
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      res.type('json').send(data);
    } else {
      res.type('json').send('[]');
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/storage/:key', (req, res) => {
  const key = req.params.key.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(LEGACY_STORAGE_DIR, key + '.json');
  try {
    const body = JSON.stringify(req.body);
    fs.writeFileSync(filePath, body, 'utf-8');
    res.json({ ok: true, key, size: body.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Health check ──────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: process.env.npm_package_version || '0.3.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── Statické soubory (stávající frontend) ─────────────────────────────────

// Blokuj citlivé soubory
app.use((req, res, next) => {
  const blocked = ['.env', 'users.json', 'hr.json', 'audit-log.json'];
  if (blocked.some(f => req.path.includes(f))) {
    return res.status(403).json({ error: 'Přístup odepřen' });
  }
  next();
});

// Servíruj frontend — v development režimu bez cache pro snadnější vývoj
const isDev = process.env.NODE_ENV !== 'production';
function staticNoCacheAssets(res, filePath) {
  // HTML/JS/CSS/manifest: no-cache = prohlížeč musí revalidovat (304 když se nic nezměnilo,
  // jinak čerstvá verze). Zabraňuje tomu, aby po deployi zůstala hodinu stará (rozbitá) verze.
  if (/\.(html?|js|css|webmanifest)$/i.test(filePath)) {
    res.setHeader('Cache-Control', 'no-cache');
  }
}
const staticOpts = isDev
  ? { maxAge: 0, etag: false, lastModified: false }
  : { maxAge: '1h', etag: true, lastModified: true, setHeaders: staticNoCacheAssets };

// Compounder — brandový PWA web (public/compounder). Web používá relativní cesty,
// takže funguje dvěma způsoby:
//   (1) na vlastní doméně compounder.world — servírováno z ROOTu domény (host routing),
//   (2) na app.holyos.cz/compounder/ — servírováno z podcesty.
// sw.js a manifest jdou s no-cache, ať se nainstalovaná PWA aktualizuje.
const COMPOUNDER_DIR = path.join(__dirname, 'public', 'compounder');
const COMPOUNDER_HOSTS = (process.env.COMPOUNDER_HOSTS || 'compounder.world,www.compounder.world')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
function reqHostname(req) {
  // za Railway proxy je původní doména v X-Forwarded-Host
  const h = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return h.split(':')[0].toLowerCase();
}
const compounderStatic = express.static(COMPOUNDER_DIR, {
  ...staticOpts,
  index: false, // index.html servírujeme ručně (no-cache), ne přes directory index
  setHeaders: staticNoCacheAssets,
});
function serveCompounderHtml(req, res) {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(COMPOUNDER_DIR, 'index.html'));
}
function serveCompounderPortal(req, res) {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(COMPOUNDER_DIR, 'portal', 'index.html'));
}

// (1) Vlastní doména compounder.world → web na rootu domény (+ /portal gated stránka).
app.use((req, res, next) => {
  if (!COMPOUNDER_HOSTS.includes(reqHostname(req))) return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/storage/')) return next();
  // Sdílené appové assety + share stránka nástrojů (Compounder Portal odkazuje na
  // /share/tools/...) musí projít na reálné routy, ne do compounder catch-all.
  if (req.path.startsWith('/share/') || req.path.startsWith('/modules/') ||
      req.path.startsWith('/css/') || req.path.startsWith('/js/') ||
      req.path.startsWith('/dist/')) return next();
  if (req.path === '/portal' || req.path === '/portal/') return serveCompounderPortal(req, res);
  compounderStatic(req, res, () => serveCompounderHtml(req, res));
});

// (2) app.holyos.cz/compounder/ → tentýž web na podcestě (trailing slash kvůli relativním cestám).
// Pozn: Express má strict routing vypnuté, takže '/compounder' matchuje i '/compounder/'.
// Redirect proto pustíme jen když lomítko opravdu chybí, jinak by vznikla smyčka.
app.get('/compounder', (req, res, next) => {
  if (req.path === '/compounder') return res.redirect(301, '/compounder/');
  next();
});
app.get('/compounder/', serveCompounderHtml);
app.get('/compounder/portal', serveCompounderPortal);
app.get('/compounder/portal/', serveCompounderPortal);
app.use('/compounder', compounderStatic);

// ─── Lokality — veřejný web bestseries.global (nabídka místa pro prádlomat) ──
// Stejný princip jako Compounder: web v public/lokality používá relativní cesty,
//   (1) na vlastní doméně bestseries.global — servírováno z ROOTu domény,
//   (2) na app.holyos.cz/lokality/ — tentýž web na podcestě.
const LOKALITY_DIR = path.join(__dirname, 'public', 'lokality');
const LOKALITY_HOSTS = (process.env.LOKALITY_HOSTS || 'bestseries.global,www.bestseries.global')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const lokalityStatic = express.static(LOKALITY_DIR, {
  ...staticOpts,
  index: false,
  setHeaders: staticNoCacheAssets,
});
function serveLokalityHtml(req, res) {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(LOKALITY_DIR, 'index.html'));
}

// (1) Vlastní doména bestseries.global → web na rootu domény.
app.use((req, res, next) => {
  if (!LOKALITY_HOSTS.includes(reqHostname(req))) return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/storage/')) return next();
  if (req.path.startsWith('/share/') || req.path.startsWith('/modules/') ||
      req.path.startsWith('/css/') || req.path.startsWith('/js/') ||
      req.path.startsWith('/dist/')) return next();
  lokalityStatic(req, res, () => serveLokalityHtml(req, res));
});

// (2) app.holyos.cz/lokality/ → tentýž web na podcestě.
app.get('/lokality', (req, res, next) => {
  if (req.path === '/lokality') return res.redirect(301, '/lokality/');
  next();
});
app.get('/lokality/', serveLokalityHtml);
app.use('/lokality', lokalityStatic);

app.use(express.static(path.join(__dirname, 'public'), staticOpts));
app.use('/modules', express.static(path.join(__dirname, 'modules'), staticOpts));
app.use('/css', express.static(path.join(__dirname, 'css'), staticOpts));
app.use('/js', express.static(path.join(__dirname, 'js'), staticOpts));
app.use('/dist', express.static(path.join(__dirname, 'dist'), staticOpts));

// Digital Asset Links — TWA (Trusted Web Activity) verification pro Android.
// APK vygenerovaný přes PWA Builder má uložený SHA256 fingerprint signing keystore;
// Android stáhne tenhle JSON z naší domény a ověří, že APK patří k téhle webové
// aplikaci. Bez tohoto souboru TWA běží s URL lištou (fallback na Custom Tabs).
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.type('application/json');
  res.sendFile(path.join(__dirname, 'public', 'well-known', 'assetlinks.json'));
});

// PWA Sklad — vite build výstup, base '/pwa/'
const PWA_DIST = path.join(__dirname, 'clients', 'pwa-sklad', 'dist');
app.use('/pwa', express.static(PWA_DIST, {
  ...staticOpts,
  // sw.js a manifest nesmí cachovat klient, jinak se neaktualizuje
  setHeaders(res, filePath) {
    if (filePath.endsWith('sw.js') || filePath.endsWith('manifest.webmanifest')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// Redirect /admin/users → modul správy uživatelů
app.get('/admin/users*', (req, res) => {
  res.redirect('/modules/sprava-uzivatelu/index.html');
});

// SPA fallback pro PWA (react-router) — musí být PŘED generickým /* fallbackem
app.get('/pwa/*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const indexPath = path.join(PWA_DIST, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      // Build PWA není přítomen (dev / první deploy) — pošli návod místo 500
      res.status(503).type('text').send(
        'PWA dist není přítomný. Spusť `npm run build` v clients/pwa-sklad/ (nebo nech Railway build).'
      );
    }
  });
});

// SPA fallback — pro stávající frontend (jen root a modules)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Error handler (musí být poslední) ─────────────────────────────────────

app.use(errorHandler);

// ─── Spuštění serveru ──────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

// ─── Ensure admin user exists on startup ──────────────────────────────────
async function ensureAdminUser() {
  try {
    const bcrypt = require('bcryptjs');
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const adminUsername = process.env.ADMIN_USERNAME || 'tomas.holy';
    const adminDisplayName = process.env.ADMIN_DISPLAY_NAME || 'Tomáš Holý';

    // Check if the user exists
    const existing = await prisma.user.findUnique({ where: { username: adminUsername } });

    if (existing) {
      // Update password hash to ensure it works with bcrypt
      const hash = await bcrypt.hash(adminPassword, 12);
      await prisma.user.update({
        where: { username: adminUsername },
        data: {
          password_hash: hash,
          role: 'admin',
          is_super_admin: true,
        },
      });
      console.log(`  ✅ Admin user '${adminUsername}' — password reset`);
    } else {
      // Create new admin
      const hash = await bcrypt.hash(adminPassword, 12);
      await prisma.user.create({
        data: {
          username: adminUsername,
          password_hash: hash,
          display_name: adminDisplayName,
          role: 'admin',
          is_super_admin: true,
        },
      });
      console.log(`  ✅ Admin user '${adminUsername}' — created`);
    }
  } catch (err) {
    console.error('  ⚠ Failed to ensure admin user:', err.message);
  }
}

// ─── Auto-expire šarží — denní sweep -------------------------------------
// Při startu backendu + každých 24 h zkoukne MaterialLot s expires_at<now
// a statusem in_stock a markne je jako expired. Žádná externí dependency,
// setInterval stačí. Lze ručně spustit přes POST /api/wh/lots/sweep-expired.
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 h
async function runExpiredLotsSweep() {
  try {
    const { sweepExpiredLots } = require('./services/warehouse/lots.service');
    const res = await sweepExpiredLots();
    if (res.marked > 0) {
      console.log(`  🧹 Sweep expired lots: ${res.marked} šarží -> status 'expired' (${res.at})`);
    }
  } catch (err) {
    console.error('  ⚠ Auto-expire lots sweep failed:', err.message);
  }
}

app.listen(PORT, async () => {
  await ensureAdminUser();
  runExpiredLotsSweep();
  setInterval(runExpiredLotsSweep, SWEEP_INTERVAL_MS);
  try {
    const emailIngestWorker = require('./services/email-ingest-worker');
    emailIngestWorker.start();
  } catch (err) {
    console.error('[app] email-ingest-worker nelze spustit:', err.message);
  }
  try {
    const digestWorker = require('./services/digest-worker');
    digestWorker.start();
  } catch (err) {
    console.error('[app] digest-worker nelze spustit:', err.message);
  }
  try {
    const dunningWorker = require('./services/dunning-worker');
    dunningWorker.start();
  } catch (err) {
    console.error('[app] dunning-worker nelze spustit:', err.message);
  }
  try {
    const reservationSweep = require('./services/compounder/reservation-sweep');
    reservationSweep.start();
  } catch (err) {
    console.error('[app] reservation-sweep nelze spustit:', err.message);
  }
  try {
    const aiDevWorker = require('./services/ai-developer/worker');
    aiDevWorker.start();
  } catch (err) {
    console.error('[app] ai-developer worker nelze spustit:', err.message);
  }
  try {
    const finalInvoiceWorker = require('./services/orders/final-invoice-worker');
    finalInvoiceWorker.start();
  } catch (err) {
    console.error('[app] final-invoice-worker nelze spustit:', err.message);
  }
  try {
    const slotReservationWorker = require('./services/slot-reservation-worker');
    slotReservationWorker.start();
  } catch (err) {
    console.error('[app] slot-reservation-worker nelze spustit:', err.message);
  }
  try {
    const velinScheduler = require('./services/workers/velin-scheduler');
    velinScheduler.start();
  } catch (err) {
    console.error('[app] velin-scheduler nelze spustit:', err.message);
  }
  try {
    const eshopReleaseWorker = require('./services/eshop/auto-release-worker');
    eshopReleaseWorker.start();
  } catch (err) {
    console.error('[app] eshop-release-worker nelze spustit:', err.message);
  }
  try {
    const eshopLowStockWorker = require('./services/eshop/low-stock-worker');
    eshopLowStockWorker.start();
  } catch (err) {
    console.error('[app] eshop-low-stock-worker nelze spustit:', err.message);
  }
  try {
    const compounderDigest = require('./services/compounder/daily-digest-worker');
    compounderDigest.start();
  } catch (err) {
    console.error('[app] compounder-digest nelze spustit:', err.message);
  }
  try {
    const salesManagerWorker = require('./services/sales/sales-manager-worker');
    salesManagerWorker.start();
  } catch (err) {
    console.error('[app] sales-manager-worker nelze spustit:', err.message);
  }
  try {
    const lossEmailWorker = require('./services/compounder/loss-email-worker');
    lossEmailWorker.start();
  } catch (err) {
    console.error('[app] loss-email-worker nelze spustit:', err.message);
  }
  console.log('=========================================');
  console.log('  HolyOS v0.5.0');
  console.log('  Listening on port ' + PORT);
  console.log('  Mode: ' + (process.env.NODE_ENV || 'development'));
  console.log('  Health: /api/health');
  console.log('=========================================');
});
