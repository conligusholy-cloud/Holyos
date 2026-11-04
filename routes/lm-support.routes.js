// HolyOS — Podpora Laundromats: servisní API pro server Laundromats (JWT podepsaný LM_SSO_SECRET,
// aud holyos-api, iss laundromats). Uživatelská část (chat zákazníka) i administrace (laundromats.eu/admin).
// Logika v services/lm-support.js — stejná data čte a píše i Velín (aplikace LM podpora).
const express = require('express');
const jwt = require('jsonwebtoken');
const S = require('../services/lm-support');

const router = express.Router();
router.use(express.json({ limit: '15mb' })); // přílohy jako base64 (max 10 MB)
router.use((req, res, next) => {
  const secret = process.env.LM_SSO_SECRET; const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!secret || !m) return res.status(401).json({ error: 'Neautorizováno' });
  try { req.svc = jwt.verify(m[1], secret, { audience: 'holyos-api', issuer: 'laundromats' }); return next(); } catch (e) { return res.status(401).json({ error: 'Neplatný token' }); }
});
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch((e) => (e.status ? res.status(e.status).json({ error: e.message }) : next(e)));
const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : NaN; };
const sendFile = (res, r) => res.set('Content-Type', r.file_type || 'application/octet-stream').set('X-Content-Type-Options', 'nosniff')
  .set('Content-Disposition', (/^image\/|application\/pdf/.test(r.file_type || '') ? 'inline' : 'attachment') + '; filename="' + encodeURIComponent(r.file_name || 'priloha') + '"')
  .set('Cache-Control', 'private, max-age=3600').send(r.file_data);

// ── Uživatel (účet laundromats.eu) ──
router.get('/user/:acc(\\d+)/state', wrap(async (req, res) => res.set('Cache-Control', 'no-store').json(await S.userState(num(req.params.acc), num(req.query.after)))));
router.get('/user/:acc(\\d+)/unread', wrap(async (req, res) => res.json({ unread: await S.userUnread(num(req.params.acc)), online: await S.getOnline() })));
router.post('/user/:acc(\\d+)/send', wrap(async (req, res) => res.json({ ok: true, msg: await S.userSend(num(req.params.acc), (req.body || {}).body, (req.body || {}).file) })));
router.get('/user/:acc(\\d+)/file/:id(\\d+)', wrap(async (req, res) => { const r = await S.userFile(num(req.params.acc), num(req.params.id)); if (!r) return res.status(404).end(); sendFile(res, r); }));

// ── Administrace (podpora) ──
router.get('/threads', wrap(async (req, res) => res.set('Cache-Control', 'no-store').json(await S.threadsResponse())));
router.get('/threads/:acc(\\d+)', wrap(async (req, res) => res.set('Cache-Control', 'no-store').json(await S.thread(num(req.params.acc), num(req.query.after)))));
router.post('/threads/:acc(\\d+)/send', wrap(async (req, res) => res.json({ ok: true, msg: await S.agentSend(num(req.params.acc), (req.body || {}).body, (req.body || {}).file, (req.body || {}).agent_name) })));
router.post('/online', wrap(async (req, res) => res.json(await S.setOnline(!!(req.body || {}).online, (req.body || {}).agent))));
router.get('/file/:id(\\d+)', wrap(async (req, res) => { const r = await S.agentFile(num(req.params.id)); if (!r) return res.status(404).end(); sendFile(res, r); }));

module.exports = router;
