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

async function stripeGet(path) {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    headers: { Authorization: 'Bearer ' + key(), 'Stripe-Version': '2024-06-20' }
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
    if (acct._subKinds.indexOf(kind) >= 0) {
      return res.status(400).json({ error: 'Tohle se platí jako předplatné.' });
    }
    const c = await itemOf(kind);   // cena z ceníku, ne z kódu
    if (!c) return res.status(400).json({ error: 'Tohle se teď neprodává.' });
    const qty = Math.max(1, Math.min(MAX_QTY, parseInt((req.body || {}).qty, 10) || 1));
    // Cena za kus padá s počtem, ale jen u karet — balíčky laundrů mají svoje
    // vlastní odstupňování a slevu podruhé nedostanou. Počítá to server,
    // klient si cenu určovat nesmí.
    // Karta se pozná podle toho, že nenese laundry — u balíků peněz je sleva
    // už v jejich odstupňování a podruhé ji nedostanou. Nespoléháme se na
    // seznam druhů: kdyby se nedotáhl, účtovali bychom jinou cenu, než jakou
    // hráč viděl.
    // Karta se pozná podle sebe: nenese laundry (balík peněz), hovory (balíček
    // infolinky) ani interval (předplatné). Slevové balíčky platí jen na karty.
    const jeKarta = !c.laundry && !c.hovory && !c.interval && !c.bezBalicku;
    const kus = jeKarta ? acct._cenaKusuVBalicku(c.price, qty) : c.price;

    const purchase = await prisma.gamePurchase.create({
      data: { player_id: p.id, kind, qty, amount_cents: kus * qty, currency: 'czk', email: p.email }
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
          currency: 'czk', unit_amount: kus,
          product_data: { name: 'Laundromat Tycoon — ' + c.name + (qty > 1 ? ' (' + qty + '×)' : ''),
            description: c.short || (c.laundry ? c.laundry.toLocaleString('cs-CZ') + ' herních laundrů' : undefined) }
        }
      }]
    });

    await prisma.gamePurchase.update({ where: { id: purchase.id }, data: { stripe_session: session.id } });
    res.json({ ok: true, url: session.url });
  } catch (e) { next(e); }
});

// ─── Předplatné ──────────────────────────────────────────────────────────────
// POST /stripe/subscribe { kind, qty } → { url }
// Opakovaná platba. Na rozdíl od karet tady nejde o jeden nákup: Stripe si
// strhává sám dokola, dokud hráč nezruší. Pravda o tom, jestli běží, je ve
// Stripu — naše tabulka je jen jeho odraz z webhooků.
const MAX_TECHNIKU = 10;
router.post('/stripe/subscribe', express.json({ limit: '8kb' }), acct._requirePlayer, async (req, res, next) => {
  try {
    if (!paymentsOn()) return res.status(503).json({ error: 'Platby zatím nejsou spuštěné.' });
    const p = req.player;
    if (!(p.email && p.first_name && p.last_name)) {
      return res.status(428).json({ error: 'Nejdřív doplň jméno a e-mail.', need_details: true });
    }
    const kind = String((req.body || {}).kind || '');
    if (acct._subKinds.indexOf(kind) < 0) return res.status(400).json({ error: 'Tohle se nepředplácí.' });
    const c = await itemOf(kind);
    if (!c) return res.status(400).json({ error: 'Tohle se teď neprodává.' });
    const qty = Math.max(1, Math.min(MAX_TECHNIKU, parseInt((req.body || {}).qty, 10) || 1));

    const bezi = (await acct._predplatneHrace(p)) || [];
    if (bezi.some((x) => x.kind === kind)) {
      return res.status(409).json({ error: 'Tohle předplatné ti už běží.' });
    }

    const row = await prisma.gameSubscription.create({
      data: { player_id: p.id, kind, qty, status: 'pending' }
    });
    const session = await stripePost('checkout/sessions', {
      mode: 'subscription',
      locale: 'cs',
      success_url: gameUrl() + '?predplatne=ok&s={CHECKOUT_SESSION_ID}',
      cancel_url: gameUrl() + '?predplatne=zrus',
      customer_email: p.email,
      client_reference_id: String(row.id),
      metadata: { sub_id: row.id, player_id: p.id, kind, qty },
      subscription_data: { metadata: { sub_id: row.id, player_id: p.id, kind } },
      line_items: [{
        quantity: qty,
        price_data: {
          currency: 'czk', unit_amount: c.price,
          recurring: { interval: c.interval || 'week' },
          product_data: { name: 'Laundromat Tycoon — ' + c.name,
            description: c.short || undefined }
        }
      }]
    });
    await prisma.gameSubscription.update({ where: { id: row.id }, data: { stripe_session: session.id } });
    res.json({ ok: true, url: session.url });
  } catch (e) { next(e); }
});

// POST /stripe/subscribe/zrusit { kind, obnovit } → zruší k datu konce období,
// nebo zrušení vezme zpátky. Nic se nestrhává ani nevrací hned — hráč má
// zaplacený týden dojetý.
router.post('/stripe/subscribe/zrusit', express.json({ limit: '8kb' }), acct._requirePlayer, async (req, res, next) => {
  try {
    const kind = String((req.body || {}).kind || '');
    const obnovit = (req.body || {}).obnovit === true;
    const row = await prisma.gameSubscription.findFirst({
      where: { player_id: req.player.id, kind, status: { in: ['active', 'past_due'] } },
      orderBy: { id: 'desc' }
    });
    if (!row || !row.stripe_sub) return res.status(404).json({ error: 'Žádné běžící předplatné.' });
    const sub = await stripePost('subscriptions/' + row.stripe_sub, { cancel_at_period_end: obnovit ? 'false' : 'true' });
    await prisma.gameSubscription.update({ where: { id: row.id },
      data: { obnovi_se: !sub.cancel_at_period_end,
        plati_do: sub.current_period_end ? new Date(sub.current_period_end * 1000) : row.plati_do } });
    res.json({ ok: true, obnovi_se: !sub.cancel_at_period_end,
      predplatne: await acct._predplatneHrace(req.player) });
  } catch (e) { next(e); }
});

// GET /stripe/status?s=cs_… → jak dopadla platba (klient se ptá po návratu)
router.get('/stripe/status', acct._requirePlayer, async (req, res, next) => {
  try {
    const sid = String(req.query.s || '').slice(0, 100);
    if (!sid) return res.status(400).json({ error: 'Chybí platba.' });
    const pu = await prisma.gamePurchase.findUnique({ where: { stripe_session: sid } });
    if (!pu) {
      // Předplatné má vlastní tabulku — hráč se vrací stejnou cestou.
      const su = await prisma.gameSubscription.findUnique({ where: { stripe_session: sid } });
      if (!su || su.player_id !== req.player.id) return res.status(404).json({ error: 'Platba nenalezena.' });
      return res.json({ ok: true, status: su.status === 'active' ? 'paid' : su.status, kind: su.kind,
        qty: su.qty, predplatne: await acct._predplatneHrace(req.player) });
    }
    if (pu.player_id !== req.player.id) return res.status(404).json({ error: 'Platba nenalezena.' });
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

// Stav předplatného ze Stripu přepíšeme do naší tabulky. Stripe je pravda,
// my jen držíme odraz, kterého se ptá hra.
const STAV = { active: 'active', trialing: 'active', past_due: 'past_due',
  unpaid: 'past_due', canceled: 'canceled', incomplete: 'pending', incomplete_expired: 'canceled' };
async function prepisPredplatne(sub) {
  if (!sub || !sub.id) return;
  let row = await prisma.gameSubscription.findUnique({ where: { stripe_sub: sub.id } });
  if (!row) {
    // Událost může přijít dřív, než se stihlo dopsat id z dokončené platby.
    // Spárujeme ji podle značky, kterou jsme Stripu dali při zakládání.
    const znacka = parseInt((sub.metadata || {}).sub_id, 10);
    if (!znacka) return;
    row = await prisma.gameSubscription.findUnique({ where: { id: znacka } });
    if (!row) return;
    await prisma.gameSubscription.update({ where: { id: row.id }, data: { stripe_sub: sub.id } });
  }
  const polozka = (sub.items && sub.items.data && sub.items.data[0]) || null;
  await prisma.gameSubscription.update({
    where: { id: row.id },
    data: {
      status: STAV[sub.status] || 'canceled',
      qty: polozka && polozka.quantity ? polozka.quantity : row.qty,
      obnovi_se: !sub.cancel_at_period_end,
      plati_do: sub.current_period_end ? new Date(sub.current_period_end * 1000) : row.plati_do
    }
  });
  console.log('[game] předplatné ' + row.kind + ' hráče ' + row.player_id + ': ' + sub.status);
}
// Zaplacené období předplatného patří i mezi objednávky. Jinak by nebylo vidět
// v tržbách a hlavně by se nevystavil doklad — ten se dělá z nákupu. Klíčem je
// faktura ze Stripu, takže jedno období se nezapíše dvakrát, ani když stejná
// událost přijde opakovaně.
async function zapisObdobi(row, faktura, castka, email) {
  if (!row || !faktura || !(castka > 0)) return null;
  let pu;
  try {
    pu = await prisma.gamePurchase.create({
      data: { player_id: row.player_id, kind: row.kind, qty: row.qty || 1,
        amount_cents: Math.round(castka), currency: 'czk', status: 'paid',
        paid_at: new Date(), stripe_session: faktura, email: email || null }
    });
  } catch (e) {
    if (e.code === 'P2002') return null;      // tohle období už zapsané máme
    throw e;
  }
  console.log('[game] předplatné zaplaceno:', row.kind, '· hráč', row.player_id,
    '·', Math.round(castka) / 100 + ' Kč');
  require('../services/bs2-billing').issueGame(pu.id)
    .then((r) => { if (r && !r.ok && !r.skipped) console.warn('[game] faktura:', r.error || r.reason); })
    .catch((e) => console.warn('[game] faktura selhala:', e.message));
  try {
    const hrac = await prisma.gamePlayer.findUnique({
      where: { id: row.player_id }, select: { id: true, nick: true, company: true }
    });
    const polozka = await acct._item(row.kind);
    require('../services/game/notify').purchasePaid(prisma, pu, hrac, polozka && polozka.name);
  } catch (e) { console.warn('[game] notifikace o předplatném:', e.message); }
  return pu;
}
async function zalozPredplatne(sess) {
  const id = parseInt((sess.metadata || {}).sub_id, 10);
  if (!id || !sess.subscription) return;
  const row = await prisma.gameSubscription.findUnique({ where: { id } });
  if (!row) return;
  if (!row.stripe_sub) {
    // Platnost nastavíme i bez dalších událostí: kdyby ve Stripu nebyly zapnuté
    // customer.subscription.*, předplatné prostě za týden samo dojde. Lepší než
    // jet dál zadarmo.
    await prisma.gameSubscription.update({
      where: { id: row.id },
      data: { stripe_sub: sess.subscription, stripe_cust: sess.customer || null,
        status: 'active', plati_do: new Date(Date.now() + 8 * 86400000) }
    });
    console.log('[game] předplatné založeno:', row.kind, '· hráč', row.player_id, '·', row.qty + '× technik');
  }
  await zapisObdobi(row, sess.invoice || sess.id, sess.amount_total,
    (sess.customer_details && sess.customer_details.email) || sess.customer_email);
  try { await stripeGet('subscriptions/' + sess.subscription).then(prepisPredplatne); }
  catch (e) { console.warn('[game] načtení předplatného:', e.message); }
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
  // Předplatné má vlastní události. Bez nich bychom se o neuhrazené platbě
  // ani o zrušení nikdy nedozvěděli — proto se musí v nastavení webhooku
  // zapnout customer.subscription.* a invoice.*.
  if (/^customer\.subscription\./.test(ev.type)) return prepisPredplatne(ev.data.object).catch(
    (e) => console.error('[game] předplatné:', e.message));
  if (ev.type === 'invoice.payment_succeeded' || ev.type === 'invoice.payment_failed') {
    const inv = ev.data.object || {};
    if (!inv.subscription) return;
    return stripeGet('subscriptions/' + inv.subscription).then(async (sub) => {
      await prepisPredplatne(sub);
      if (ev.type !== 'invoice.payment_succeeded') return;
      const row = await prisma.gameSubscription.findUnique({ where: { stripe_sub: sub.id } });
      await zapisObdobi(row, inv.id, inv.amount_paid, inv.customer_email);
    }).catch((e) => console.error('[game] předplatné z faktury:', e.message));
  }
  if (ev.type !== 'checkout.session.completed' && ev.type !== 'checkout.session.async_payment_succeeded') return;
  // Založení předplatného chodí jako obyčejné dokončení platby, jen v režimu
  // subscription — a místo karet se zapisuje do vlastní tabulky.
  if (ev.data.object && ev.data.object.mode === 'subscription') {
    return zalozPredplatne(ev.data.object).catch((e) => console.error('[game] předplatné:', e.message));
  }

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
    // Doklad (řada GM) — vystaví se vždy, odešle se podle nastavení v Účetní doklady → GAME
    require('../services/bs2-billing').issueGame(pu.id).then((r) => { if (r && !r.ok && !r.skipped) console.warn('[game] faktura:', r.error || r.reason); }).catch((e) => console.warn('[game] faktura selhala:', e.message));
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
module.exports._zapisObdobi = zapisObdobi;
module.exports._stripeGet = stripeGet;
module.exports._prepisPredplatne = prepisPredplatne;
