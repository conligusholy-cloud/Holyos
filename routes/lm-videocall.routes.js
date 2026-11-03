// HolyOS — videohovory z laundromats.eu/videocall: upozornění Janovi a Tomášovi (Velín push + zvonek)
// a ICE servery (STUN/TURN přes Twilio Network Traversal) pro spojení přes mobilní sítě a firemní NAT.
// Volá jen server Laundromats (servisní JWT podepsaný LM_SSO_SECRET).
const express = require('express');
const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');

const router = express.Router();
router.use(express.json({ limit: '20kb' }));
router.use((req, res, next) => {
  const secret = process.env.LM_SSO_SECRET; const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!secret || !m) return res.status(401).json({ error: 'Neautorizováno' });
  try { jwt.verify(m[1], secret, { audience: 'holyos-api', issuer: 'laundromats' }); return next(); } catch (e) { return res.status(401).json({ error: 'Neplatný token' }); }
});
const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

// POST /notify {room, name, phone, email, note, lead_id} → push + zvonek Janovi a Tomášovi s odkazem do hovoru
router.post('/notify', async (req, res, next) => {
  try {
    const b = req.body || {};
    const room = s(b.room, 40); if (!/^[a-f0-9]{16,40}$/.test(room)) return res.status(400).json({ error: 'Neplatná místnost' });
    const base = String(process.env.LM_URL || 'https://laundromats.eu').replace(/\/$/, '');
    const name = s(b.name, 120) || 'Návštěvník', note = s(b.note, 300);
    const ps = await prisma.person.findMany({ where: { active: true, last_name: { equals: 'Holý', mode: 'insensitive' }, first_name: { in: ['Jan', 'Tomáš'], mode: 'insensitive' } }, select: { id: true, user_id: true, first_name: true, last_name: true } });
    const { notifyPerson } = require('../services/push/expo-push');
    const { createNotification } = require('./notifications.routes');
    const title = '🎥 Videohovor z laundromats.eu';
    const body = name + ' s vámi chce mluvit' + (note ? ' — ' + note : '') + (b.phone ? ' · ' + s(b.phone, 40) : '');
    const sent = [];
    for (const p of ps) {
      const who = [p.first_name, p.last_name].filter(Boolean).join(' ');
      const k = jwt.sign({ room, name: who, pid: p.id }, process.env.LM_SSO_SECRET, { audience: 'lm-vc-agent', issuer: 'holyos', expiresIn: '3h' });
      const url = base + '/videocall/agent/' + room + '?k=' + encodeURIComponent(k);
      notifyPerson(prisma, p.id, { title, body, data: { type: 'videocall', url, room }, sound: 'default', bypassQuiet: true }).catch((e) => console.warn('[lm-vc] push:', e.message));
      if (p.user_id) createNotification({ userId: p.user_id, type: 'system', title, body, link: url, meta: { room, kind: 'videocall' } }).catch(() => {});
      sent.push(who);
    }
    const leadId = Number(b.lead_id) || null;
    if (leadId) prisma.compounderEvent.create({ data: { sid: 'server:vc:' + room.slice(0, 20), event: 'videocall_request', path: '/videocall', props: { site: 'laundromats', lead_id: leadId, room } } }).catch(() => {});
    console.log('[lm-vc] upozornění na videohovor', room, '→', sent.join(', '));
    res.json({ ok: true, notified: sent });
  } catch (err) { next(err); }
});

// GET /ice → { iceServers } — Twilio NTS (TURN, platnost 4 h) s cache; záloha veřejný STUN
let _ice = { at: 0, data: null };
router.get('/ice', async (req, res) => {
  const fallback = [{ urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }];
  try {
    if (_ice.data && Date.now() - _ice.at < 3 * 3600e3) return res.json({ iceServers: _ice.data });
    const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !tok) return res.json({ iceServers: fallback, turn: false });
    const client = require('twilio')(sid, tok);
    const t = await client.tokens.create({ ttl: 4 * 3600 });
    const list = (t.iceServers || t.ice_servers || []).map((x) => ({ urls: x.urls || x.url, username: x.username, credential: x.credential }));
    _ice = { at: Date.now(), data: list.length ? list : fallback };
    res.json({ iceServers: _ice.data, turn: list.length > 0 });
  } catch (e) { console.warn('[lm-vc] ice:', e.message); res.json({ iceServers: fallback, turn: false }); }
});

module.exports = router;
