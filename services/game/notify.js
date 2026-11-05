// =============================================================================
// HolyOS — Laundromats Milionář: notifikace do Velína
// =============================================================================
// Majitelé chtějí vědět hned, když ve hře přibude hráč nebo někdo něco koupí.
// Posíláme push do Velína a zároveň zvonek v HolyOS — stejně jako u Compounderu.
//
// Příjemce jde přenastavit v AppSetting pod klíčem níž (JSON pole Person.id).
// Když tam nic není, chodí to majitelům podle e-mailů v GAME_OWNER_EMAILS.
// Nic z toho nesmí shodit hru — všechno je fire-and-forget a chyby jen logujeme.
// =============================================================================

'use strict';

const { getSetting } = require('../settings');
const { notifyPerson } = require('../push/expo-push');
const { createNotification } = require('../../routes/notifications.routes');

const NOTIFY_SETTING_KEY = 'milionar.velin_notify_person_ids';
const OWNER_EMAILS_DEFAULT = 'jan.holy@bestseries.cz,tomas.holy@bestseries.cz';
const LINK = '/modules/milionar/index.html';

// Výchozí příjemci (Person.id majitelů) — použije se, když v nastavení nic není.
async function defaultRecipientPersonIds(prisma) {
  const emails = (process.env.GAME_OWNER_EMAILS || OWNER_EMAILS_DEFAULT)
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (!emails.length) return [];
  const persons = await prisma.person.findMany({
    where: { OR: emails.map((e) => ({ email: { equals: e, mode: 'insensitive' } })) },
    select: { id: true }
  });
  return persons.map((p) => p.id);
}

async function resolveRecipientPersonIds(prisma) {
  const ids = await getSetting(NOTIFY_SETTING_KEY, { type: 'json', defaultValue: [] });
  if (Array.isArray(ids) && ids.length) return ids.filter((n) => Number.isInteger(n) && n > 0);
  return defaultRecipientPersonIds(prisma);
}

// Jádro: rozešle push do Velína + zvonek v HolyOS.
async function dispatch(prisma, { title, body, data }) {
  let personIds = [];
  try { personIds = await resolveRecipientPersonIds(prisma); }
  catch (e) { console.warn('[milionar-notify] příjemci:', e.message); }
  if (!personIds.length) return;

  const persons = await prisma.person.findMany({
    where: { id: { in: personIds } },
    select: { id: true, user_id: true }
  });

  for (const p of persons) {
    notifyPerson(prisma, p.id, {
      title, body,
      data: Object.assign({ link: LINK }, data || {}),
      sound: 'default'
    }).catch((e) => console.warn('[milionar-notify] push', p.id, ':', e.message));

    if (p.user_id) {
      createNotification({ userId: p.user_id, type: 'system', title, body, link: LINK })
        .catch((e) => console.warn('[milionar-notify] zvonek', p.user_id, ':', e.message));
    }
  }
}

function fmtCzk(n) { return (Math.round(Number(n) || 0)).toLocaleString('cs-CZ') + ' Kč'; }
function kdoJe(player) {
  if (!player) return 'někdo';
  const firma = (player.company || '').trim();
  return firma && firma !== player.nick ? firma + ' (' + player.nick + ')' : player.nick;
}

// Nový účet ve hře.
async function newPlayer(prisma, player) {
  try {
    let celkem = null;
    try { celkem = await prisma.gamePlayer.count(); } catch (e) { /* počet není důležitý */ }
    await dispatch(prisma, {
      title: '🎮 Nový hráč v Milionáři',
      body: kdoJe(player) + ' si právě založil(a) účet.'
        + (celkem ? ' Hráčů celkem: ' + celkem + '.' : ''),
      data: { udalost: 'milionar_novy_hrac', player_id: player.id }
    });
  } catch (e) { console.warn('[milionar-notify] nový hráč:', e.message); }
}

// Zaplacený nákup (karta nebo balíček laundry). Voláme až po ověřeném webhooku,
// takže notifikace chodí jen na peníze, které opravdu přišly.
async function purchasePaid(prisma, purchase, player, nazevPolozky) {
  try {
    const castka = (Number(purchase.amount_cents) || 0) / 100;
    let trzby = null;
    try {
      const a = await prisma.gamePurchase.aggregate({
        where: { status: 'paid' }, _sum: { amount_cents: true }
      });
      trzby = (a._sum.amount_cents || 0) / 100;
    } catch (e) { /* součet není důležitý */ }
    const nazev = nazevPolozky || purchase.kind;
    await dispatch(prisma, {
      title: '💰 Nákup ve hře — ' + fmtCzk(castka),
      body: kdoJe(player) + ': ' + purchase.qty + '× ' + nazev + '.'
        + (trzby ? ' Tržby ze hry celkem ' + fmtCzk(trzby) + '.' : ''),
      data: { udalost: 'milionar_nakup', purchase_id: purchase.id, player_id: purchase.player_id }
    });
  } catch (e) { console.warn('[milionar-notify] nákup:', e.message); }
}

module.exports = { newPlayer, purchasePaid, NOTIFY_SETTING_KEY };
