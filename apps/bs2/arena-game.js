// BS2 — Aréna: online „aukce" o slevové kupony na první prádlomat (30 % / 20 % / 10 %).
// Kola běží každých 30 s (zarovnaná na čas serveru). Připojí se každý živý hráč, který dohrál kvíz
// a je zrovna online; chybí-li živí, doplní se fiktivní hráči (~20 % zobrazeného počtu návštěvníků).
// Pravidla pro živé: 30 % jen 1 z 50 kol (2 %), 20 % jen každé 10. kolo (10 %), jinak 10 %.
// Ostatní živí v kole dostanou účastnický kupon 10 %. Jeden živý (sid) může kupon 20/30 % vyhrát jen jednou.
const ROUND_MS = 30000;
const P30 = 0.02, P20 = 0.10;           // pravděpodobnosti, že živý hráč vyhraje 30 % / 20 %
const BOT_SHARE = 0.2, BOT_MIN = 3, BOT_MAX = 14;
const FIRST = ['Petr', 'Jana', 'Martin', 'Lucie', 'Tomáš', 'Eva', 'Jiří', 'Hana', 'Pavel', 'Marie', 'Jan', 'Lenka', 'Michal', 'Kateřina', 'David', 'Tereza', 'Ondřej', 'Veronika', 'Jakub', 'Monika', 'Lukáš', 'Markéta', 'Roman', 'Barbora', 'Radek', 'Zuzana', 'Karel', 'Alena', 'Milan', 'Simona', 'Aleš', 'Nikola', 'Vojtěch', 'Klára', 'Filip', 'Dana', 'Josef', 'Ivana', 'Marek', 'Petra', 'Zdeněk', 'Kristýna', 'Daniel', 'Adéla', 'Patrik', 'Michaela'];
const LAST = 'BCDHJKLMNPRSTVZ';

const rounds = new Map();     // roundId → { players: Map(sid → {name, bank, joined}), result }
const wonBig = new Map();     // sid → nejvyšší vyhraný kupon (20/30) – pojistka proti opakované výhře
let seq = 0;

function roundId(t) { return Math.floor((t || Date.now()) / ROUND_MS); }
function roundEnd(id) { return (id + 1) * ROUND_MS; }
function cur() { const id = roundId(); if (!rounds.has(id)) rounds.set(id, { players: new Map(), result: null, bots: null }); if (rounds.size > 40) { for (const k of [...rounds.keys()].sort((a, b) => a - b).slice(0, rounds.size - 40)) rounds.delete(k); } return { id, r: rounds.get(id) }; }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function botName(used) { for (let i = 0; i < 50; i++) { const n = pick(FIRST) + ' ' + pick(LAST) + '.'; if (!used.has(n)) { used.add(n); return n; } } return pick(FIRST) + ' ' + (++seq) + '.'; }
function bots(count, used) { const out = []; for (let i = 0; i < count; i++) out.push({ name: botName(used), bank: pick([50000, 100000, 100000, 150000, 150000, 200000, 250000]), bot: true }); return out; }
function code(pct) { const s = Math.random().toString(36).slice(2, 7).toUpperCase(); return 'ARENA' + pct + '-' + s; }

// Připojení do nejbližšího otevřeného kola (aktuální, pokud do konce zbývá ≥ 4 s, jinak příští)
function join({ sid, name, bank, presence }) {
  if (!sid || !name) return null;
  let { id, r } = cur(); if (roundEnd(id) - Date.now() < 4000) { id += 1; if (!rounds.has(id)) rounds.set(id, { players: new Map(), result: null, bots: null }); r = rounds.get(id); }
  if (!r.players.has(sid)) r.players.set(sid, { name: String(name).slice(0, 40), bank: Math.max(0, Number(bank) || 0), joined: Date.now() });
  if (!r.bots) { const n = Math.max(BOT_MIN, Math.min(BOT_MAX, Math.round((Number(presence) || 0) * BOT_SHARE))); r.bots = bots(n, new Set([...r.players.values()].map((p) => p.name))); }
  return state(id, sid);
}

// Vyhodnocení kola (jednou; idempotentní)
function resolve(id) {
  const r = rounds.get(id); if (!r) return null; if (r.result) return r.result;
  const humans = [...r.players.entries()].map(([sid, p]) => ({ sid, name: p.name, bank: p.bank, bot: false }));
  if (!r.bots) r.bots = bots(BOT_MIN, new Set(humans.map((h) => h.name)));
  const pool = r.bots.slice();
  let podium = [];
  if (humans.length) {
    const lucky = pick(humans); const x = Math.random(); const prev = wonBig.get(lucky.sid) || 0;
    let place = x < P30 ? 1 : (x < P30 + P20 ? 2 : 3);
    if (place === 1 && prev >= 30) place = 3; if (place === 2 && prev >= 20) place = 3; // pojistka: velký kupon jen jednou
    const b = pool.sort(() => Math.random() - .5);
    podium = [null, null, null]; podium[place - 1] = lucky; let bi = 0; for (let i = 0; i < 3; i++) if (!podium[i]) podium[i] = b[bi++] || { name: botName(new Set()), bank: 100000, bot: true };
    if (place < 3) wonBig.set(lucky.sid, place === 1 ? 30 : 20);
  } else { const b = pool.sort(() => Math.random() - .5); podium = [b[0], b[1], b[2]].map((p) => p || { name: botName(new Set()), bank: 100000, bot: true }); }
  const pct = [30, 20, 10];
  const result = { id, podium: podium.map((p, i) => ({ name: p.name, bot: !!p.bot, pct: pct[i], bank: p.bank })), coupons: {} };
  humans.forEach((h) => { const i = podium.findIndex((p) => !p.bot && p.sid === h.sid); const pc = i >= 0 ? pct[i] : 10; result.coupons[h.sid] = { pct: pc, place: i >= 0 ? i + 1 : 0, code: code(pc) }; });
  r.result = result; return result;
}

function state(id, sid) {
  const r = rounds.get(id) || { players: new Map(), result: null, bots: null }; const now = Date.now(); const end = roundEnd(id);
  if (now >= end && !r.result && rounds.has(id)) resolve(id);
  const list = [...r.players.values()].map((p) => ({ name: p.name, bank: p.bank, bot: false })).concat((r.bots || []).map((b) => ({ name: b.name, bank: b.bank, bot: true })));
  const res = r.result ? { podium: r.result.podium, mine: sid ? (r.result.coupons[sid] || null) : null } : null;
  return { round: id, ends_at: end, ends_in: Math.max(0, end - now), phase: res ? 'result' : 'open', players: list, joined: sid ? r.players.has(sid) : false, result: res, next_round: id + 1, server_now: now };
}

function stateFor(sid, id) { const rid = id != null ? Number(id) : roundId(); return state(rid, sid); }

module.exports = { join, stateFor, resolve, ROUND_MS, roundId };
