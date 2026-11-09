// =============================================================================
// Laundromat Tycoon — platby za zrychlující karty (Stripe Checkout)
// =============================================================================
// Stejný postup jako Stripe u /misto (compounder.routes.js): REST API přes
// fetch, bez SDK, podpis webhooku ověřený ručně. STRIPE_SECRET_KEY už v projektu
// je — pro hru stačí přidat druhý webhook endpoint a jeho tajemství:
//   STRIPE_WEBHOOK_SECRET_GAME  whsec_… pro https://…/api/game/stripe/webhook
// (není-li nastavené, bere se STRIPE_WEBHOOK_SECRET)
// Dokud chybí klíč, nákup se hráči vůbec nenabídne a tahle routa vrací 503.
//
// Karty se připisují VÝHRADNĚ na potvrzený webhook, nikdy po návratu z platby —
// návratovou adresu si může kdokoli otevřít sám.
const express = require('express');
const crypto = require('crypto');
const { prisma } = require('../config/database');
const acct = require('./game-account.routes');

const router = express.Router();
const itemOf = acct._item;
const MAX_QTY = 10;

const key = () => process.env.STRIPE_SECRET_KEY || '';
const gameUrl = () => (process.env.PRADLOMATY_BASE_URL || 'https://pradlomaty.info').replace(/\/+$/, '') + '/game';
// Tajemství je VLASTNÍ pro tenhle endpoint. Vzít to od /misto by nefungovalo —
// každý webhook endpoint má ve Stripu svoje a podpis by nikdy neseděl.
const hookSecret = () => process.env.STRIPE_WEBHOOK_SECRET_GAME || '';
// Tajemství musí vypadat jako tajemství. Nestačí „je něco nastaveno" — omylem
// vložený zástupný text by zapnul prodej, ale podpis by neprošel a zákazník by
// zaplatil bez karty.
const SECRET_RE = /^whsec_[A-Za-z0-9+/=_-]{16,}$/;
const secretOk = () => SECRET_RE.test(hookSecret());
// Prodávat smíme jen tehdy, když umíme i doručit, tedy ověřit webhook.
const paymentsOn = () => !!(process.env.STRIPE_SECRET_KEY && secretOk());

// ─── Volání Stripe API (form-encoded, jak ho Stripe chce) ────────────────────
function flat(obj, prefix, out) {
  out = out || {}; 
  Object.keys(obj).forEach((k) => {
    const v = obj[k]; const name = prefix ? prefix + '[' + k + ']' : k;
    if (v == null) return;
    if (typeof v === 'object') flat(v, name, out); else out[name] = String(v);
  });
  return out;
}
async function stripePost(path, body) {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-06-20'
    },
    body: new URLSearchParams(flat(body)).toString()
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Stripe: ' + ((j.error && j.error.message) || r.status));
  return j;
}

// ─── Založení platby ─────────────────────────────────────────────────────────
// POST /stripe/checkout { kind, qty } → { url }
router.post('/stripe/checkout', express.json({ limit: '8kb' }), acct._requirePlayer, async (req, res, next) => {
  try {
    if (!paymentsOn()) return res.status(503).json({ error: 'Platby zatím nejsou spuštěné.' });
    const p = req.player;
    if (!(p.email && p.first_name && p.last_name)) {
      return res.status(428).json({ error: 'Nejdřív doplň jméno a e-mail.', need_details: true });
    }
    const kind = String((req.body || {}).kind || '');
    const c = await itemOf(kind);   // cena z ceníku, ne z kódu
    if (!c) return res.status(400).json({ error: 'Tohle se teď neprodává.' });
    const qty = Math.max(1, Math.min(MAX_QTY, parseInt((req.body || {}).qty, 10) || 1));

    const purchase = await prisma.gamePurchase.create({
      data: { player_id: p.id, kind, qty, amount_cents: c.price * qty, currency: 'czk', email: p.email }
    });

    const session = await stripePost('checkout/sessions', {
      mode: 'payment',
      locale: 'cs',
      invoice_creation: { enabled: 'true' },
      success_url: gameUrl() + '?platba=ok&s={CHECKOUT_SESSION_ID}',
      cancel_url: gameUrl() + '?platba=zrus',
      customer_email: p.email,
      client_reference_id: String(purchase.id),
      metadata: { purchase_id: purchase.id, player_id: p.id, kind, qty },
      payment_intent_data: { metadata: { purchase_id: purchase.id } },
      line_items: [{
        quantity: qty,
        price_data: {
          currency: 'czk', unit_amount: c.price,
          product_data: { name: 'Laundromat Tycoon — ' + c.name,
            description: c.short || (c.laundry ? c.laundry.toLocaleString('cs-CZ') + ' herních laundrů' : undefined) }
        }
      }]
    });

    await prisma.gamePurchase.update({ where: { id: purchase.id }, data: { stripe_session: session.id } });
    res.json({ ok: true, url: session.url });
  } catch (e) { next(e); }
});

// GET /stripe/status?s=cs_… → jak dopadla platba (klient se ptá po návratu)
router.get('/stripe/status', acct._requirePlayer, async (req, res, next) => {
  try {
    const sid = String(req.query.s || '').slice(0, 100);
    if (!sid) return res.status(400).json({ error: 'Chybí platba.' });
    const pu = await prisma.gamePurchase.findUnique({ where: { stripe_session: sid } });
    if (!pu || pu.player_id !== req.player.id) return res.status(404).json({ error: 'Platba nenalezena.' });
    res.json({ ok: true, status: pu.status, kind: pu.kind, qty: pu.qty, owned: (await acct._pub(req.player)).cards });
  } catch (e) { next(e); }
});

// ─── Webhook ─────────────────────────────────────────────────────────────────
// Musí dostat NEZPRACOVANÉ tělo, jinak podpis nesedí — proto express.raw
// a proto se v app.js mountuje dřív než JSON parsery.
function verify(raw, sigHeader, secret) {
  const parts = {};
  String(sigHeader || '').split(',').forEach((kv) => { const i = kv.indexOf('='); if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); });
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false; // starší pět minut neberem
  const mine = crypto.createHmac('sha256', secret).update(parts.t + '.' + raw).digest('hex');
  const a = Buffer.from(mine), b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const webhook = [express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  // Bez tajemství podpis neověříme — pak by kdokoli mohl podvrhnout „zaplaceno".
  const secret = hookSecret();
  if (!secretOk()) {
    console.error('[game] STRIPE_WEBHOOK_SECRET_GAME chybí nebo není platné whsec_ — webhook odmítnut');
    return res.status(503).send('Webhook není nakonfigurován');
  }
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  if (!verify(raw, req.headers['stripe-signature'], secret)) return res.status(400).send('bad signature');

  let ev; try { ev = JSON.parse(raw); } catch (e) { return res.status(400).send('bad json'); }
  // Stripe čeká 2xx rychle; všechno ostatní jen zalogujeme.
  res.json({ received: true });
  if (ev.type !== 'checkout.session.completed' && ev.type !== 'checkout.session.async_payment_succeeded') return;

  try {
    const sess = ev.data.object;
    if (sess.payment_status && sess.payment_status !== 'paid') return;
    const pid = parseInt((sess.metadata || {}).purchase_id, 10);
    if (!pid) return;
    const pu = await prisma.gamePurchase.findUnique({ where: { id: pid } });
    if (!pu || pu.status === 'paid') return; // webhook může přijít vícekrát
    await prisma.$transaction([
      prisma.gamePurchase.update({
        where: { id: pu.id },
        data: { status: 'paid', paid_at: new Date(), stripe_intent: sess.payment_intent || null }
      }),
      prisma.gameCard.createMany({
        data: Array.from({ length: pu.qty }, () => ({ player_id: pu.player_id, kind: pu.kind, purchase_id: pu.id }))
      })
    ]);
    console.log('[game] zaplaceno:', pu.qty + '× ' + pu.kind, '· hráč', pu.player_id);
    // Majitelům do Velína — až tady, po ověřeném podpisu, takže jen na skutečné platby.
    try {
      const hrac = await prisma.gamePlayer.findUnique({
        where: { id: pu.player_id }, select: { id: true, nick: true, company: true }
      });
      const polozka = await acct._item(pu.kind);
      require('../services/game/notify').purchasePaid(prisma, pu, hrac, polozka && polozka.name);
    } catch (e) { console.warn('[game] notifikace o nákupu:', e.message); }
  } catch (e) { console.error('[game] webhook:', e.message); }
}];

module.exports = router;
module.exports._webhook = webhook;
module.exports._paymentsOn = paymentsOn;
