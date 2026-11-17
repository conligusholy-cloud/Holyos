// =============================================================================
// HolyOS — Laundromats Milionář: AI hlídání textů, které hráči ukazují ostatním
// =============================================================================
// Hráči si spolu přímo psát nemůžou, ale pořád posílají vzkazy u nabídek na
// Burze a vymýšlí si nick a název firmy, který vidí konkurence na mapě
// i v žebříčku. Každý takový text tady krátce posoudí AI: jestli nepoškozuje
// nás (Best Series, prádlomaty, hru) nebo jména z hlídaného seznamu (Špagetka…),
// jestli neláká hráče jinam, nešíří kontakty, podvod nebo urážky.
//
// Výsledek se ukládá do game_moderace (i „v pořádku", ať je u hráče vidět, co
// všechno poslal). Při podezření nebo škodě jde push do Velína + zvonek.
// Nic z toho nesmí zdržet ani shodit hru — všechno běží na pozadí.
//
// Nastavení (AppSetting game.moderace):
//   { zapnuto: true, jmena: ['Best Series', 'Špagetka', …], person_ids: [1, …] }
//   person_ids prázdné = stejní příjemci jako ostatní notifikace hry.
// =============================================================================

'use strict';

const { prisma } = require('../../config/database');
const { getSetting } = require('../settings');

const KEY = 'game.moderace';
const MODEL = process.env.GAME_MODERACE_MODEL || process.env.GAME_PORADCE_MODEL || 'claude-haiku-4-5-20251001';
const LINK = '/modules/milionar/index.html';
const VYCHOZI = {
  zapnuto: true,
  jmena: ['Best Series', 'Best Series 2.0', 'BS2', 'HolyOS', 'Laundromats', 'Laundromat Tycoon', 'prádlomaty', 'pradlomaty.info', 'Compounder', 'Špagetka', 'Tomáš Holý', 'Jan Holý'],
  person_ids: [],
};
const ZDROJE = { vzkaz: 'vzkaz u obchodu', firma: 'název firmy', nick: 'nick', zprava: 'zpráva hráči' };

async function nastaveni() {
  const v = await getSetting(KEY, { type: 'json', defaultValue: null }).catch(() => null);
  return Object.assign({}, VYCHOZI, v && typeof v === 'object' ? v : {});
}

// Rychlé předsítko bez AI: odkazy, e-maily, telefony a hlídaná jména jdou vždy
// k AI; úplně krátké a „čisté" texty (např. „díky", „beru") AI vůbec neuvidí.
function stojiZaKontrolu(text, jmena) {
  const t = String(text || '').trim();
  if (t.length < 3) return false;
  if (/https?:|www\.|\.(cz|com|sk|eu|net|org)\b|@|\d{3}\s?\d{3}\s?\d{3}/i.test(t)) return true;
  const low = t.toLowerCase();
  if ((jmena || []).some((j) => j && low.includes(String(j).toLowerCase()))) return true;
  return t.length >= 12 || /[!?]{2,}/.test(t);
}

async function posoudit(text, ctx, cfg) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const Anthropic = require('@anthropic-ai/sdk');
  const { messagesCreate } = require('../anthropic-retry');
  const client = new Anthropic({ apiKey });
  const system = [
    'Jsi moderátor online ekonomické hry Laundromat Tycoon (hra o stavění prádlomatů), kterou provozuje firma Best Series.',
    'Posuzuješ jeden krátký text, který hráč ukazuje ostatním hráčům (' + (ZDROJE[ctx.zdroj] || ctx.zdroj) + ').',
    'Hlídaná jména (provozovatel, jeho značky a partneři): ' + (cfg.jmena || []).join(', ') + '.',
    'Označ jako "skodi", když text: pomlouvá nebo zesměšňuje provozovatele či hlídaná jména, tvrdí, že jde o podvod/šmejdy,',
    'odrazuje lidi od nákupu prádlomatů nebo od hry, láká hráče ke konkurenci nebo mimo hru (odkazy, telefony, e-maily, jiné weby),',
    'nabízí obchod za skutečné peníze mimo hru, je vulgární, výhrůžný nebo rasistický.',
    'Označ jako "podezrele", když to tak vyznít může, ale není to jisté (ironie, dvojsmysl, náznak kontaktu).',
    'Jinak "ok". Běžné herní vyjednávání ("dám ti víc", "ber, nebo nech být") je ok.',
    'Odpověz POUZE JSON: {"verdikt":"ok|podezrele|skodi","cil":"koho to poškozuje nebo null","duvod":"krátce česky, max 140 znaků"}',
  ].join('\n');
  const resp = await messagesCreate(client, {
    model: MODEL, max_tokens: 200, system,
    messages: [{ role: 'user', content: 'Hráč: ' + ctx.nick + (ctx.komu ? '\nPříjemce: ' + ctx.komu : '') + '\nText: """' + String(text).slice(0, 800) + '"""' }],
  }, { label: 'game-moderace' });
  const out = ((resp && resp.content) || []).filter((c) => c && c.type === 'text').map((c) => c.text).join('');
  const m = /\{[\s\S]*\}/.exec(out);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const v = ['ok', 'podezrele', 'skodi'].includes(j.verdikt) ? j.verdikt : 'podezrele';
    return { verdikt: v, cil: j.cil ? String(j.cil).slice(0, 120) : null, duvod: String(j.duvod || '').slice(0, 300) };
  } catch (e) { return null; }
}

async function upozornit(cfg, row, nick) {
  try {
    let ids = Array.isArray(cfg.person_ids) ? cfg.person_ids.filter((n) => Number.isInteger(n) && n > 0) : [];
    if (!ids.length) {
      const emails = (process.env.GAME_OWNER_EMAILS || 'jan.holy@bestseries.cz,tomas.holy@bestseries.cz').split(',').map((x) => x.trim()).filter(Boolean);
      ids = (await prisma.person.findMany({ where: { OR: emails.map((e) => ({ email: { equals: e, mode: 'insensitive' } })) }, select: { id: true } })).map((p) => p.id);
    }
    if (!ids.length) return;
    const persons = await prisma.person.findMany({ where: { id: { in: ids } }, select: { id: true, user_id: true } });
    const { notifyPerson } = require('../push/expo-push');
    let createNotification = null; try { createNotification = require('../../routes/notifications.routes').createNotification; } catch (e) { /* bez zvonku */ }
    const title = (row.verdikt === 'skodi' ? '⚠️ Hra: hráč škodí' : '👀 Hra: podezřelý text') + ' — ' + nick;
    const body = (ZDROJE[row.zdroj] || row.zdroj) + ': „' + String(row.text).slice(0, 120) + '"' + (row.duvod ? ' · ' + row.duvod : '');
    const link = LINK + '?tab=nahlasene&hrac=' + row.player_id;
    for (const p of persons) {
      notifyPerson(prisma, p.id, { title, body, data: { type: 'game_moderace', id: row.id, link }, sound: 'default' }).catch(() => {});
      if (p.user_id && createNotification) createNotification({ userId: p.user_id, type: 'system', title, body, link }).catch(() => {});
    }
  } catch (e) { console.warn('[game-moderace] notifikace:', e.message); }
}

// Hlavní vstup: zkontroluj({ player: {id, nick}, zdroj, refId, text, komu })
// Volá se bez await — nikdy nevyhodí chybu.
function zkontroluj(o) {
  (async () => {
    const text = String((o && o.text) || '').trim();
    if (!text || !o.player || !o.player.id) return;
    const cfg = await nastaveni();
    if (cfg.zapnuto === false) return;
    let r = { verdikt: 'ok', cil: null, duvod: 'krátký běžný text — bez AI' };
    if (stojiZaKontrolu(text, cfg.jmena)) {
      try { r = (await posoudit(text, { zdroj: o.zdroj, nick: o.player.nick, komu: o.komu }, cfg)) || { verdikt: 'nezname', cil: null, duvod: 'AI nebyla k dispozici' }; }
      catch (e) { r = { verdikt: 'nezname', cil: null, duvod: 'AI chyba: ' + String(e.message || e).slice(0, 120) }; }
    }
    const row = await prisma.gameModerace.create({ data: {
      player_id: o.player.id, zdroj: String(o.zdroj || 'jine').slice(0, 12), ref_id: o.refId || null,
      komu: o.komu ? String(o.komu).slice(0, 60) : null, text: text.slice(0, 800),
      verdikt: r.verdikt, cil: r.cil, duvod: r.duvod || null,
    } });
    if (r.verdikt === 'skodi' || r.verdikt === 'podezrele') await upozornit(cfg, row, o.player.nick || ('#' + o.player.id));
  })().catch((e) => console.warn('[game-moderace]', e && e.message));
}

module.exports = { zkontroluj, nastaveni, KEY, VYCHOZI, ZDROJE };
