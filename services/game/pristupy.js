// =============================================================================
// HolyOS — Laundromat Tycoon: záznam přístupů (kdo, odkud, z jakého zařízení)
// =============================================================================
// Pro odhalování multi účtů (services/game/podvod.js). Ukládá se:
//   • registrace, přihlášení,
//   • průběžná aktivita (nejvýš 1× za 20 min na hráče, nebo hned při změně
//     IP / zařízení / otisku),
//   • každá nabídka, protinávrh a přijetí obchodu na Burze (s id obchodu).
// Zařízení: dev = trvalé id z localStorage (lm_milionar_pid), fp = otisk
// prohlížeče (canvas, WebGL, písma, obrazovka…), hw = otisk hardwaru (přežije
// i jiný prohlížeč na stejném počítači / telefonu). Posílá je klient v hlavičkách
// X-LM-Dev / X-LM-Fp / X-LM-Hw. Hráčům se nic z toho neukazuje.
// Nic z toho nesmí shodit hru — zápis běží na pozadí a chyby se jen logují.
// =============================================================================
'use strict';

const { prisma } = require('../../config/database');

const RE = /^[a-z0-9]{6,40}$/;
const posledni = new Map(); // player_id → { ip, dev, fp, hw, at }
const ipOf = (req) => String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.ip || '').trim().slice(0, 64) || null;
const hl = (req, h) => { const v = String(req.headers[h] || '').toLowerCase().slice(0, 40); return RE.test(v) ? v : null; };

function stopa(req) {
  return { ip: ipOf(req), dev: hl(req, 'x-lm-dev'), fp: hl(req, 'x-lm-fp'), hw: hl(req, 'x-lm-hw'),
    ua: String(req.headers['user-agent'] || '').slice(0, 300) || null };
}

// zapis(req, playerId, druh, refId) — druh: registrace | prihlaseni | aktivita | nabidka | protinavrh | prijeti
function zapis(req, playerId, druh, refId) {
  try {
    const id = Number(playerId); if (!id) return;
    const s = stopa(req), ted = Date.now();
    if (druh === 'aktivita') {
      const p = posledni.get(id);
      if (p && p.ip === s.ip && p.dev === s.dev && p.fp === s.fp && p.hw === s.hw && ted - p.at < 20 * 60e3) return;
    }
    posledni.set(id, { ip: s.ip, dev: s.dev, fp: s.fp, hw: s.hw, at: ted });
    if (posledni.size > 20000) posledni.clear();
    prisma.gameAccess.create({ data: { player_id: id, druh: String(druh).slice(0, 12), ref_id: refId ? Number(refId) : null,
      ip: s.ip, dev: s.dev, fp: s.fp, hw: s.hw, ua: s.ua } })
      .catch((e) => console.warn('[game-pristupy]', e.message));
  } catch (e) { console.warn('[game-pristupy]', e.message); }
}

module.exports = { zapis, stopa };
