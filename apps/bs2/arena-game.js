// BS2 — Aréna: živá aukce o slevové kupony na první prádlomat (30 % / 20 % / 10 %).
// Jedna společná aukce pro všechny online: odpočet od 60 s, každý příhoz vrátí +5 s (max. 60 s).
// Příhoz = stejná nebo vyšší částka než aktuální nejvyšší, max. do výše vlastního kapitálu; každý má 8 příhozů.
// Vyhrává ten, kdo přihodí jako poslední a čas vyprší; 2. a 3. místo = předchozí odlišní přihazující.
// Fiktivní hráči přihazují realisticky (častěji ke konci). Pojistky pro živé: 30 % jen ve 2 % aukcí,
// 20 % jen v 10 % aukcí, jinak 10 %; velký kupon (20/30) může jeden živý (sid) vyhrát jen jednou.
const START_MS = 60000, BUMP_MS = 5000, MAX_MS = 60000, AMMO = 5, RESULT_HOLD_MS = 25000, MAX_ROUND_MS = 150000;
const P30 = 0.02, P20 = 0.10;
const BOT_SHARE = 0.2, BOT_MIN = 3, BOT_MAX = 12;
const FIRST = ['Petr', 'Jana', 'Martin', 'Lucie', 'Tomáš', 'Eva', 'Jiří', 'Hana', 'Pavel', 'Marie', 'Jan', 'Lenka', 'Michal', 'Kateřina', 'David', 'Tereza', 'Ondřej', 'Veronika', 'Jakub', 'Monika', 'Lukáš', 'Markéta', 'Roman', 'Barbora', 'Radek', 'Zuzana', 'Karel', 'Alena', 'Milan', 'Simona', 'Aleš', 'Nikola', 'Vojtěch', 'Klára', 'Filip', 'Dana', 'Josef', 'Ivana', 'Marek', 'Petra', 'Zdeněk', 'Kristýna', 'Daniel', 'Adéla', 'Patrik', 'Michaela'];
const LAST = 'BCDHJKLMNPRSTVZ';
const STEPS = [5000, 5000, 10000, 10000, 10000, 25000];

let active = null;            // aktuální aukce
const history = [];           // poslední ukončené (pro výsledky)
const wonBig = new Map();     // sid → nejvyšší vyhraný kupon 20/30
let seq = 0;

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function botName(used) { for (let i = 0; i < 60; i++) { const n = pick(FIRST) + ' ' + pick(LAST) + '.'; if (!used.has(n)) { used.add(n); return n; } } return pick(FIRST) + ' ' + (++seq) + '.'; }
function code(pct) { return 'ARENA' + pct + '-' + Math.random().toString(36).slice(2, 7).toUpperCase(); }

function newRound(presence) {
  const id = Date.now(); const used = new Set();
  const nBots = Math.max(BOT_MIN, Math.min(BOT_MAX, Math.round((Number(presence) || 0) * BOT_SHARE)));
  const bots = []; for (let i = 0; i < nBots; i++) bots.push({ id: 'b' + id + '_' + i, name: botName(used), bank: pick([100000, 100000, 150000, 150000, 200000, 250000, 300000]), ammo: AMMO + Math.floor(Math.random() * 4), bot: true, nextAt: Date.now() + 2000 + Math.random() * 9000 });
  // Pojistka: kam až smí v této aukci dojít živý hráč (rozhodne se dopředu)
  const x = Math.random(); const humanMax = x < P30 ? 1 : (x < P30 + P20 ? 2 : 3);
  active = { id, startedAt: Date.now(), endsAt: Date.now() + START_MS, top: 0, last: null, bids: [], players: new Map(), bots, humanMax, ended: false, result: null, usedNames: used };
  return active;
}

function ensureRound(presence) { if (!active || (active.ended && Date.now() - active.endedAt > RESULT_HOLD_MS)) newRound(presence); return active; }

function join({ sid, name, bank, presence }) {
  if (!sid || !name) return null; const r = ensureRound(presence);
  if (r.ended) return state(sid); // výsledky ještě běží – klient počká na další aukci
  if (!r.players.has(sid)) { let nm = String(name).slice(0, 40); if (r.usedNames.has(nm)) nm = nm + ' ' + (r.players.size + 1); r.usedNames.add(nm); r.players.set(sid, { sid, name: nm, bank: Math.max(0, Number(bank) || 0), ammo: AMMO, bot: false, joined: Date.now() }); }
  return state(sid);
}

function placeBid(r, p, amount, now) {
  amount = Math.round(amount); if (!(amount > 0) || amount < r.top || amount > p.bank || p.ammo <= 0) return false;
  // stejný hráč po sobě nepřihazuje (nemá smysl) – jen když ho někdo přehodil
  if (r.last && r.last.id === (p.sid || p.id)) return false;
  p.ammo--; r.top = amount; r.last = { id: p.sid || p.id, name: p.name, bot: !!p.bot, t: now, amount };
  r.bids.push({ name: p.name, amount, bot: !!p.bot, t: now }); if (r.bids.length > 60) r.bids.shift();
  r.endsAt = Math.min(now + MAX_MS, r.endsAt + BUMP_MS); if (r.endsAt - now < BUMP_MS) r.endsAt = now + BUMP_MS;
  return true;
}

function bid({ sid, amount }) {
  const r = active; if (!r || r.ended) return { ok: false, error: 'Aukce neběží' }; const p = r.players.get(sid); if (!p) return { ok: false, error: 'Nejste v aukci' };
  const ok = placeBid(r, p, Number(amount), Date.now());
  if (!ok) return { ok: false, error: r.last && r.last.id === sid ? 'Vedete – počkejte, až vás někdo přehodí' : (p.ammo <= 0 ? 'Příhozy jsou vyčerpané' : (amount > p.bank ? 'Nad váš kapitál' : 'Příhoz musí být aspoň ' + r.top.toLocaleString('cs-CZ') + ' Kč')) };
  return { ok: true, state: state(sid) };
}

// Chování botů + konec aukce; volá se při každém čtení stavu a z tiku
function tick() {
  const r = active; if (!r || r.ended) return; const now = Date.now(); const left = r.endsAt - now; const age = now - r.startedAt;
  const lastHuman = r.last && !r.last.bot; const humans = [...r.players.values()];
  // kolik botů smí přihodit po posledním příhozu živého, aby živý skončil na povoleném místě

  for (const b of r.bots) {
    if (now < b.nextAt || b.ammo <= 0) continue;
    const isLeader = r.last && r.last.id === b.id; if (isLeader) { b.nextAt = now + 3000; continue; }
    // ke konci přihazují častěji; po limitu délky aukce boti přestávají (ať aukce skončí)
    let want = age < MAX_ROUND_MS && (left < 9000 ? Math.random() < 0.6 : Math.random() < 0.22);
    // Pojistka podle povoleného místa živého hráče: 1 = boti po něm už nepřihazují, 2 = přihodí právě jeden, 3 = přihodí aspoň dva
    const hw = humanAllowed(r); const after = botsAfterHuman(r); const humanBidExists = r.bids.some((x) => !x.bot);
    if (lastHuman) { if (hw === 1) want = false; else if (hw === 2) want = left <= 6000 || Math.random() < 0.3; else want = left <= 6000 || Math.random() < 0.5; }
    else if (humanBidExists) { if (hw === 2 && after >= 1) want = false; else if (hw === 3 && after < 2) want = want || left <= 6000; }
    // boti nikdy nepřehodí nejvyšší kapitál živých hráčů – živý může vždy aspoň dorovnat
    const humanCap = humans.length ? Math.max(...humans.map((h) => h.bank)) : Infinity; const cap = Math.min(b.bank, humanCap);
    if (want) { const same = Math.random() < 0.5 || r.top >= cap; const amt = r.top ? Math.min(cap, same ? r.top : r.top + pick(STEPS)) : Math.min(cap, pick([10000, 15000, 20000, 25000])); if (amt >= r.top && amt > 0) placeBid(r, b, amt, now); }
    b.nextAt = now + (left < 9000 ? 1500 + Math.random() * 3000 : 4000 + Math.random() * 9000);
  }
  if (Date.now() >= r.endsAt) finish(r);
}
// Nejvyšší povolené místo pro živého hráče, který přihodil naposledy (resp. jako poslední z živých)
function humanAllowed(r) { let lastH = null; for (let i = r.bids.length - 1; i >= 0; i--) if (!r.bids[i].bot) { lastH = r.bids[i]; break; } if (!lastH) return 3; const h = [...r.players.values()].find((p) => p.name === lastH.name); const prev = h ? (wonBig.get(h.sid) || 0) : 0; let max = r.humanMax; if (max === 1 && prev >= 30) max = 3; if (max === 2 && prev >= 20) max = 3; return max; }
function botsAfterHuman(r) { let n = 0; for (let i = r.bids.length - 1; i >= 0; i--) { if (r.bids[i].bot) n++; else break; } return n; }

function finish(r) {
  if (r.ended) return; r.ended = true; r.endedAt = Date.now();
  // pořadí: poslední přihazující, pak předchozí odlišní
  const order = []; const seen = new Set(); for (let i = r.bids.length - 1; i >= 0 && order.length < 3; i--) { const b = r.bids[i]; const key = b.name; if (seen.has(key)) continue; seen.add(key); order.push({ name: b.name, bot: b.bot, amount: b.amount }); }
  const pct = [30, 20, 10]; const podium = order.map((o, i) => ({ name: o.name, bot: o.bot, pct: pct[i], amount: o.amount }));
  const coupons = {}; const list = [];
  for (const p of r.players.values()) { const i = podium.findIndex((x) => !x.bot && x.name === p.name); const pc = i >= 0 ? pct[i] : 10; coupons[p.sid] = { pct: pc, place: i >= 0 ? i + 1 : 0, code: code(pc) }; if (i >= 0 && pc >= 20) wonBig.set(p.sid, Math.max(wonBig.get(p.sid) || 0, pc)); list.push({ name: p.name, bot: false, pct: pc, place: i >= 0 ? i + 1 : 0 }); }
  for (const b of r.bots) { const i = podium.findIndex((x) => x.bot && x.name === b.name); list.push({ name: b.name, bot: true, pct: i >= 0 ? pct[i] : (b.ammo < AMMO ? 10 : 0), place: i >= 0 ? i + 1 : 0 }); }
  list.sort((a, b) => (a.place || 9) - (b.place || 9) || b.pct - a.pct);
  r.result = { podium, list, coupons, top: r.top };
  history.unshift(r); if (history.length > 10) history.pop();
}

function state(sid) {
  tick(); const r = active; if (!r) return { phase: 'idle' };
  const me = sid ? r.players.get(sid) : null; const now = Date.now();
  const base = { round: r.id, phase: r.ended ? 'result' : 'open', ends_in: Math.max(0, r.endsAt - now), max_ms: MAX_MS, top: r.top, last: r.last ? { name: r.last.name, bot: r.last.bot, amount: r.last.amount } : null, bids: r.bids.slice(-10).reverse(), players: [...r.players.values()].map((p) => ({ name: p.name, bot: false })).concat(r.bots.map((b) => ({ name: b.name, bot: true }))), joined: !!me, me: me ? { name: me.name, bank: me.bank, ammo: me.ammo, leading: !!(r.last && r.last.id === me.sid) } : null, server_now: now };
  if (r.ended) { base.result = { podium: r.result.podium, list: r.result.list, mine: sid ? (r.result.coupons[sid] || null) : null, top: r.result.top }; base.next_in = Math.max(0, RESULT_HOLD_MS - (now - r.endedAt)); }
  return base;
}
function couponFor(sid, roundId) { const r = (active && active.id === Number(roundId)) ? active : history.find((x) => x.id === Number(roundId)); return r && r.result ? (r.result.coupons[sid] || null) : null; }

setInterval(() => { try { tick(); } catch (e) { /* tichý tik */ } }, 1000);
module.exports = { join, bid, state, couponFor, ensureRound };
