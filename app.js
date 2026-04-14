// =============================================================================
// HolyOS — Express aplikace (hlavní soubor)
// =============================================================================

require('dotenv').config();

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
const warehouseRoutes = require('./routes/warehouse.routes');
const mindmapRoutes = require('./routes/mindmap.routes');
const adminTasksRoutes = require('./routes/admin-tasks.routes');
const auditRoutes = require('./routes/audit.routes');
const aiRoutes = require('./routes/ai.routes');
const storageRoutes = require('./routes/storage.routes');
const voiceRoutes = require('./routes/voice.routes');
const chatRoutes = require('./routes/chat.routes');
const productionRoutes = require('./routes/production.routes');
const devRoutes = require('./routes/dev.routes');

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

    // Vrať jen bezpečná data (bez interních ID, created_by atd.)
    res.json({
      order_number: order.order_number,
      company_name: order.company?.name || '—',
      status: order.status,
      currency: order.currency,
      total_amount: order.total_amount,
      expected_delivery: order.expected_delivery,
      note: order.note,
      items: order.items.map(it => ({
        name: it.name,
        quantity: it.quantity,
        unit: it.unit,
        unit_price: it.unit_price,
        total_price: it.total_price,
        configs: it.configs.map(c => ({
          group_name: c.option?.group?.name || '',
          option_name: c.option?.name || '',
          custom_value: c.custom_value,
        })),
      })),
    });
  } catch (err) {
    console.error('Chyba veřejného náhledu:', err);
    res.status(500).json({ error: 'Interní chyba serveru' });
  }
});

// Veřejná stránka pro prohlížení objednávky
app.get('/order/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'order-view.html'));
});

// ─── API Routes ────────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/wh', warehouseRoutes);
app.use('/api/mindmap', mindmapRoutes);
app.use('/api/admin-tasks', adminTasksRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/ai', voiceRoutes);  // stt-check, transcribe, voice (bez auth)
app.use('/api/ai', chatRoutes);   // chat endpoint (bez auth — pro panel)
app.use('/api/ai', aiRoutes);     // asistenti, konverzace (s auth)
app.use('/api/storage', storageRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/dev', devRoutes);

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
const staticOpts = isDev ? { maxAge: 0, etag: false, lastModified: false } : { maxAge: '1h' };
app.use(express.static(path.join(__dirname, 'public'), staticOpts));
app.use('/modules', express.static(path.join(__dirname, 'modules'), staticOpts));
app.use('/css', express.static(path.join(__dirname, 'css'), staticOpts));
app.use('/js', express.static(path.join(__dirname, 'js'), staticOpts));
app.use('/dist', express.static(path.join(__dirname, 'dist'), staticOpts));

// Redirect /admin/users → modul správy uživatelů
app.get('/admin/users*', (req, res) => {
  res.redirect('/modules/sprava-uzivatelu/index.html');
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

app.listen(PORT, async () => {
  await ensureAdminUser();
  console.log(`
  ╔══════════════════════════════════════════╗
  ║          HolyOS v0.5.0                   ║
  ║          http://localhost:${PORT}           ║
  ║                                          ║
  ║  API:     auth, hr, wh, mindmap, tasks   ║
  ║          audit, ai, storage, production ║
  ║          dev (agents & tools)           ║
  ║  MCP:     warehouse, hr, production,    ║
  ║          tasks, dev (in-process)        ║
  ║  Health:  /api/health                    ║
  ║  Mode:    ${process.env.NODE_ENV || 'development'}                   ║
  ╚══════════════════════════════════════════╝
  `);
});

module.exports = app;
