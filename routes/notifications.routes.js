// =============================================================================
// HolyOS — Notifications routes (zvonek + SSE stream)
// =============================================================================
// GET  /api/notifications              — seznam (nejnovější první, paginace)
// GET  /api/notifications/unread-count — počet nepřečtených
// POST /api/notifications/:id/read     — označit 1 jako přečtenou
// POST /api/notifications/read-all     — označit všechny jako přečtené
// GET  /api/notifications/stream       — SSE stream live updatů (heartbeat každých 25s)
// =============================================================================

const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');
const bus = require('../services/notification-bus');
const { sendMail } = require('../services/email');

// Typy notifikací, pro které odesíláme email (ostatní jen v appce)
const EMAIL_TYPES = new Set(['chat_message', 'task_status', 'mention']);

// ─── Helpers ────────────────────────────────────────────────────────────────

// SSE autentizace: EventSource neumí posílat vlastní hlavičky, proto token
// akceptujeme z ?token=… query paramu, cookie nebo Authorization hlavičky.
async function authFromQueryOrHeader(req, res, next) {
  try {
    let token = null;
    if (req.query && req.query.token) token = String(req.query.token);
    else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7);
    } else if (req.cookies && req.cookies.token) token = req.cookies.token;

    if (!token) return res.status(401).json({ error: 'Nepřihlášen' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) return res.status(401).json({ error: 'Uživatel neexistuje' });

    req.user = {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Neplatný token' });
  }
}

// ─── REST endpoints (vyžadují standardní auth) ─────────────────────────────

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const onlyUnread = req.query.unread === 'true';

    const where = { user_id: req.user.id };
    if (onlyUnread) where.read_at = null;

    const items = await prisma.notification.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
    });
    res.json(items);
  } catch (err) { next(err); }
});

router.get('/unread-count', requireAuth, async (req, res, next) => {
  try {
    const count = await prisma.notification.count({
      where: { user_id: req.user.id, read_at: null },
    });
    res.json({ count });
  } catch (err) { next(err); }
});

router.post('/:id/read', requireAuth, async (req, res, next) => {
  try {
    const n = await prisma.notification.updateMany({
      where: { id: req.params.id, user_id: req.user.id, read_at: null },
      data: { read_at: new Date() },
    });
    res.json({ ok: true, updated: n.count });
  } catch (err) { next(err); }
});

router.post('/read-all', requireAuth, async (req, res, next) => {
  try {
    const n = await prisma.notification.updateMany({
      where: { user_id: req.user.id, read_at: null },
      data: { read_at: new Date() },
    });
    res.json({ ok: true, updated: n.count });
  } catch (err) { next(err); }
});

// ─── SSE stream (live notifikace + zprávy) ─────────────────────────────────
// Formát eventů:
//   event: notification   data: { ...notification }
//   event: message        data: { channel_id, message }
//   event: channel_update data: { channel_id }
//   event: ping           data: { ts }                 (heartbeat každých 25s)

router.get('/stream', authFromQueryOrHeader, (req, res) => {
  const userId = req.user.id;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering (nginx/Railway)
  res.flushHeaders?.();

  // Uvítací event (klient zjistí že je spojen)
  res.write(`event: connected\ndata: ${JSON.stringify({ userId })}\n\n`);

  bus.addClient(userId, res);

  // Heartbeat aby spojení nezmizelo kvůli idle timeoutu na proxy
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    } catch (_) {}
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    bus.removeClient(userId, res);
  });
});

// ─── Publikační helper (pro ostatní moduly) ────────────────────────────────
// Použití z routes:
//   const { createNotification } = require('./notifications.routes');
//   await createNotification({ userId, type, title, body, link, meta });

async function createNotification({ userId, type, title, body = null, link = null, meta = null, forceEmail = false }) {
  const n = await prisma.notification.create({
    data: { user_id: userId, type, title, body, link, meta: meta || undefined },
  });

  // Push do SSE (instant)
  const delivered = bus.publishToUser(userId, 'notification', n);

  // Email — jen pro vybrané typy a jen když user není aktivně online (nebo vynucený)
  // Tím zabráníme spamu: když user sedí v appce, dostane live notifikaci,
  // a email ho "dohání" jen pokud není u počítače.
  if ((forceEmail || delivered === 0) && EMAIL_TYPES.has(type)) {
    sendEmailForNotification(userId, n).catch(e => {
      console.error('[Notif email] chyba:', e.message);
    });
  }

  return n;
}

async function sendEmailForNotification(userId, notification) {
  // Najdi email uživatele (primárně z person.email, fallback na .env admin email)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { person: { select: { email: true, first_name: true } } },
  });
  if (!user) return;
  const to = user.person?.email;
  if (!to) return; // žádný email — tiše přeskočíme

  const appUrl = process.env.APP_URL || '';
  const fullLink = notification.link
    ? (notification.link.startsWith('http') ? notification.link : (appUrl ? appUrl.replace(/\/$/, '') + notification.link : notification.link))
    : '';

  await sendMail({
    to,
    subject: notification.title,
    body: notification.body,
    link: fullLink,
    linkLabel: 'Otevřít v HolyOS',
    preheader: notification.body ? notification.body.slice(0, 120) : notification.title,
  });
}

router.createNotification = createNotification;

module.exports = router;
