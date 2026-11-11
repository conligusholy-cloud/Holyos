// =============================================================================
// HolyOS — IT požadavky (checklist pro zákazníka k objednávce)
// =============================================================================
// Interní (auth):  /api/it-requests/*        — šablona checklistu, odeslání zákazníkovi, stav
// Veřejné (token): /api/public/it-requests/* — zákazník vyplní formulář (stránka /it-pozadavky/<token>)
// =============================================================================

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const svc = require('../services/orders/it-request');

const router = express.Router();
router.use(requireAuth);

router.get('/template', async (req, res, next) => {
  try { res.json({ items: await svc.getTemplate(), due_days: await svc.getDueDays() }); } catch (err) { next(err); }
});
router.put('/template', async (req, res, next) => {
  try { res.json({ items: await svc.saveTemplate((req.body || {}).items) }); }
  catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});
router.get('/settings', async (req, res, next) => {
  try { res.json(await svc.getSettings()); } catch (err) { next(err); }
});
router.put('/settings', async (req, res, next) => {
  try { res.json(await svc.saveSettings(req.body || {})); } catch (err) { next(err); }
});
router.post('/test', async (req, res, next) => {
  try { res.json(await svc.sendTest((req.body || {}).email)); }
  catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});
router.post('/test-nayax', async (req, res, next) => {
  try { const b = req.body || {}; res.json(await svc.sendNayaxTest(b.email, b)); }
  catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});
router.get('/order/:orderId', async (req, res, next) => {
  try { res.json({ request: await svc.getForOrder(parseInt(req.params.orderId, 10)) }); } catch (err) { next(err); }
});
router.post('/order/:orderId/send', async (req, res, next) => {
  try {
    const r = await svc.sendToCustomer(parseInt(req.params.orderId, 10), { email: (req.body || {}).email, userId: req.user && req.user.id, actor: req.user && (req.user.username || req.user.email) });
    res.json({ ok: true, sent: r.sent, mail_error: r.mail_error, url: r.url, due_at: r.due_at });
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});

// ── Veřejné (bez auth) ───────────────────────────────────────────────────────
const publicRouter = express.Router();
publicRouter.get('/:token', async (req, res, next) => {
  try {
    const d = await svc.getPublic(req.params.token);
    if (!d) return res.status(404).json({ error: 'Odkaz není platný' });
    res.json(d);
  } catch (err) { next(err); }
});
publicRouter.post('/:token', express.json({ limit: '200kb' }), async (req, res, next) => {
  try {
    const b = req.body || {};
    res.json(await svc.submitPublic(req.params.token, b.answers || {}, b.name));
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});

module.exports = router;
module.exports.publicRouter = publicRouter;
