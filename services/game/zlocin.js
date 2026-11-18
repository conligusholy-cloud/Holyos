// =============================================================================
// HolyOS — Laundromat Tycoon: pravidla zločinu (kontroly, soud) + vyhodnocení nanečisto
// =============================================================================
// Pravidla se ukládají do AppSetting 'game.zlocin_pravidla' a upravují v administraci
// hry (záložka Zločin). Tenhle soubor zatím jen VYHODNOCUJE — kdo by pravidla splnil,
// kolik by činila škoda a který útvar by případ vedl. Nic nezabavuje ani neblokuje.
// =============================================================================
'use strict';

const { getSetting, setSetting } = require('../settings');
const KEY = 'game.zlocin_pravidla';

const VYCHOZI = {
  zapnuto: false,              // automatické řízení ve hře (zatím neexistuje, jen příprava)
  min_pod: 5,                  // kolik koncových účtů musí být pod hráčem
  podil_mrtvych: 80,           // % koncových účtů zrušených / smazaných / nehrajících
  min_odehrano_min: 30,        // kdo odehrál méně, bere se jako zrušený
  max_hloubka: 8,              // do jaké úrovně pod hráčem se strom prochází
  koef_zabaveni: 1.2,          // škoda × tohle se zmrazí při zahájení kontroly
  trest_nejnizsi: 1.0,         // verdikt: násobek škody
  trest_stredni: 1.2,
  trest_nejvyssi: 1.3,
  kontrola_mesicu: 1,          // herních měsíců
  soud_mesicu: 1,
  porotce_min_mesicu: 2,       // porotce = hráč starší než tolik herních měsíců
  recidiva_dni: 3,             // zákaz provizí / nákupů / aliancí při dalším podvodu
  hranice_nahled: 60,          // % — hráči nad touhle hranicí (ale pod pravidlem) jdou do „na hraně"
  // Ochrana platících: kdo za balíčky zaplatil skutečné peníze, nesmí během kontroly a soudu
  // smazat účet a jeho koupené balíčky / věci se mu po rozsudku vrátí do hry znovu
  // (aby nemohl říct, že jsme ho ošidili). Trest se kryje z ostatního majetku.
  // Druhá cesta: KUPEC — kdo skupuje stroje od zrušených / nehrajících účtů hluboko pod cenou,
  // i když je nepozval (nemusí být ve stromu pozvaných).
  min_kupu_od_mrtvych: 3,      // kolik různých zrušených prodejců
  kup_max_pomer: 60,           // % ceníku — levnější než tohle se počítá jako „pod cenou"
  chranit_platici: true,
  vratit_balicky: true,
};

const LIMITY = {
  min_pod: [1, 100], podil_mrtvych: [10, 100], min_odehrano_min: [0, 600], max_hloubka: [1, 20],
  koef_zabaveni: [0.5, 5], trest_nejnizsi: [0.5, 5], trest_stredni: [0.5, 5], trest_nejvyssi: [0.5, 5],
  kontrola_mesicu: [0, 12], soud_mesicu: [0, 12], porotce_min_mesicu: [0, 24], recidiva_dni: [0, 90],
  hranice_nahled: [10, 100], min_kupu_od_mrtvych: [1, 100], kup_max_pomer: [5, 100],
};

async function nastaveni() {
  const v = await getSetting(KEY, { type: 'json', defaultValue: {} }).catch(() => ({}));
  return Object.assign({}, VYCHOZI, v && typeof v === 'object' ? v : {});
}

async function uloz(vstup) {
  const out = Object.assign({}, await nastaveni());
  const b = vstup && typeof vstup === 'object' ? vstup : {};
  if ('zapnuto' in b) out.zapnuto = !!b.zapnuto;
  if ('chranit_platici' in b) out.chranit_platici = !!b.chranit_platici;
  if ('vratit_balicky' in b) out.vratit_balicky = !!b.vratit_balicky;
  Object.keys(LIMITY).forEach((k) => {
    if (!(k in b)) return;
    const n = Number(b[k]);
    if (!Number.isFinite(n)) return;
    out[k] = Math.min(LIMITY[k][1], Math.max(LIMITY[k][0], n));
  });
  await setSetting(KEY, out, { type: 'json', description: 'Laundromat Tycoon — pravidla zločinu (admin hry → Zločin)', scope: 'game' });
  return out;
}

const LIST = { mini: Math.round(35000 * 24.35 * 1.25), flex: Math.round(52000 * 24.35 * 1.25), max: Math.round(67000 * 24.35 * 1.25) };
const cenik = (m) => LIST[String(m || '').toLowerCase()] || LIST.mini;
const SMAZANY = 'smazaný hráč';

// Vyhodnocení nanečisto: kdo by dnes spadl do kontroly.
async function nanecisto(prisma, pravidla) {
  const R = pravidla || await nastaveni();
  const [hraci, davky, obchody, mista] = await Promise.all([
    prisma.gamePlayer.findMany({ select: { id: true, nick: true, company: true, created_at: true, hra_s_celkem: true,
      invited_by_id: true, invited_by_ref: true, ref_id: true, disabled: true } }),
    prisma.gameDelivery.findMany({ where: { kind: 'cash', popis: { startsWith: 'Provize' } }, select: { player_id: true, spot_id: true, amount: true } }),
    prisma.gameTrade.findMany({ where: { stav: 'prijato', predmet: { in: ['stroj', 'pradlomat'] } },
      select: { id: true, from_id: true, to_id: true, smer: true, predmet: true, model: true, cena: true } }),
    prisma.gameSpotClaim.findMany({ select: { player_id: true, spot_id: true } }),
  ]);

  // Kolik který hráč skutečně zaplatil (Kč přepočtem) — platící je chráněný před smazáním účtu
  const platil = {};
  try {
    const MENY = require('./meny');
    const kurzy = await MENY.kurzy();
    const nak = await prisma.gamePurchase.findMany({ where: { status: 'paid' }, select: { player_id: true, amount_cents: true, currency: true } });
    nak.forEach((n) => { platil[n.player_id] = (platil[n.player_id] || 0) + MENY.naKoruny(n.amount_cents, String(n.currency || 'czk').toLowerCase(), kurzy); });
  } catch (e) { /* bez plateb se nanečisto počítá dál */ }

  const P = {}, podleRef = {};
  hraci.forEach((h) => { P[h.id] = h; if (h.ref_id) podleRef[h.ref_id] = h; });
  const zvouci = (h) => P[h.invited_by_id] || podleRef[h.invited_by_ref] || null;
  const deti = {};
  hraci.forEach((h) => { const z = zvouci(h); if (z && z.id !== h.id) (deti[z.id] = deti[z.id] || []).push(h); });

  const minSek = R.min_odehrano_min * 60;
  const mrtvy = (h) => h.nick === SMAZANY || !!h.disabled || (h.hra_s_celkem || 0) < minSek;

  // Provize: kdo komu za koho
  const majitel = {}; mista.forEach((m) => { majitel[m.spot_id] = m.player_id; });
  const provizeKomu = {}; // komu → { za(pozvaný id) → částka }
  davky.forEach((d) => {
    const m = /^nakup:(\d+):/.exec(String(d.spot_id || ''));
    const za = m ? Number(m[1]) : majitel[d.spot_id];
    if (!za) return;
    const o = provizeKomu[d.player_id] || (provizeKomu[d.player_id] = {});
    o[za] = (o[za] || 0) + (Number(d.amount) || 0);
  });
  // Nákupy: kupující → [{ od, cena, model }]
  const nakupy = {};
  obchody.forEach((t) => {
    const prod = t.smer === 'koupim' ? t.to_id : t.from_id, kup = t.smer === 'koupim' ? t.from_id : t.to_id;
    (nakupy[kup] = nakupy[kup] || []).push({ od: prod, cena: Number(t.cena) || 0, model: t.model, predmet: t.predmet });
  });

  const vysledek = [], nahled = [];
  hraci.forEach((h) => {
    if (!deti[h.id]) return;
    // Celý strom pod hráčem (s pojistkou proti cyklu a hloubce)
    const strom = new Map(); // id → hloubka
    const fronta = [[h.id, 0]];
    while (fronta.length) {
      const [id, hl] = fronta.shift();
      if (hl >= R.max_hloubka) continue;
      (deti[id] || []).forEach((c) => { if (c.id === h.id || strom.has(c.id)) return; strom.set(c.id, hl + 1); fronta.push([c.id, hl + 1]); });
    }
    if (!strom.size) return;
    const ids = [...strom.keys()];
    const koncove = ids.filter((id) => !(deti[id] || []).some((c) => strom.has(c.id)));
    const mrtve = koncove.filter((id) => mrtvy(P[id]));
    const zivychMezi = ids.filter((id) => !koncove.includes(id) && !mrtvy(P[id]));
    const hloubka = Math.max.apply(null, ids.map((id) => strom.get(id)));
    const podil = koncove.length ? Math.round(mrtve.length / koncove.length * 100) : 0;

    // Důkazy: provize ze stromu a nákupy od stromu
    const prov = provizeKomu[h.id] || {};
    // Škoda jen ze zrušených / nehrajících účtů — provize od živých hráčů je v pořádku
    const provize = ids.reduce((a, id) => a + (mrtvy(P[id]) ? (prov[id] || 0) : 0), 0);
    const kup = (nakupy[h.id] || []).filter((x) => strom.has(x.od) && mrtvy(P[x.od]));
    const sleva = kup.reduce((a, x) => a + Math.max(0, cenik(x.model) - x.cena), 0);
    const odMrtvych = kup.filter((x) => mrtvy(P[x.od])).length;
    const mamDukaz = provize > 0 || kup.length > 0;

    const radek = {
      id: h.id, nick: h.nick, firma: h.company || null, zalozen: h.created_at,
      nadrazeny: (zvouci(h) || {}).nick || null,
      pod_celkem: ids.length, koncovych: koncove.length, mrtvych: mrtve.length, podil_mrtvych: podil,
      zivych_mezi: zivychMezi.length, hloubka,
      provize: Math.round(provize), nakupu_ks: kup.length, nakupu_od_mrtvych: odMrtvych, sleva: Math.round(sleva),
      mrtvi_nicky: mrtve.slice(0, 8).map((id) => P[id].nick),
    };
    radek.platil_kc = Math.round(platil[h.id] || 0);
    radek.platici = radek.platil_kc > 0;
    radek.skoda = Math.round(provize + sleva);
    radek.zmrazit = Math.round(radek.skoda * R.koef_zabaveni);
    radek.trest = { nejnizsi: Math.round(radek.skoda * R.trest_nejnizsi), stredni: Math.round(radek.skoda * R.trest_stredni), nejvyssi: Math.round(radek.skoda * R.trest_nejvyssi) };
    // Který útvar případ vede: podle převažujícího prohřešku
    radek.utvar = (provize >= sleva && provize > 0) ? 'Finanční úřad' : (kup.length ? 'Celní správa' : 'Policie');

    if (koncove.length >= R.min_pod && podil >= R.podil_mrtvych && mamDukaz) { radek.stav = 'kontrola'; vysledek.push(radek); }
    else if (koncove.length >= Math.max(2, R.min_pod - 2) && podil >= R.hranice_nahled && mamDukaz) { radek.stav = 'na hraně'; nahled.push(radek); }
  });
  // ── Druhá cesta: KUPEC (nákupy hluboko pod cenou od zrušených účtů, bez ohledu na strom pozvaných) ──
  const maxPomer = R.kup_max_pomer / 100;
  const radekPodleId = {}; vysledek.concat(nahled).forEach((r) => { radekPodleId[r.id] = r; });
  hraci.forEach((h) => {
    const levne = (nakupy[h.id] || []).filter((x) => P[x.od] && mrtvy(P[x.od]) && x.od !== h.id
      && (Number(x.cena) || 0) < maxPomer * cenik(x.model));
    const prodejci = new Set(levne.map((x) => x.od));
    if (prodejci.size < R.min_kupu_od_mrtvych) return;
    const sleva = levne.reduce((a, x) => a + Math.max(0, cenik(x.model) - x.cena), 0);
    const ex = radekPodleId[h.id];
    if (ex) { ex.kupuje_levne = levne.length; return; }   // už je ve výsledku přes strom pozvaných
    const radek = {
      id: h.id, nick: h.nick, firma: h.company || null, zalozen: h.created_at, nadrazeny: (zvouci(h) || {}).nick || null,
      typ: 'kupec', pod_celkem: 0, koncovych: 0, mrtvych: prodejci.size, podil_mrtvych: 100, zivych_mezi: 0, hloubka: 0,
      provize: 0, nakupu_ks: levne.length, nakupu_od_mrtvych: levne.length, sleva: Math.round(sleva),
      mrtvi_nicky: [...prodejci].slice(0, 8).map((id) => P[id].nick),
      platil_kc: Math.round(platil[h.id] || 0),
    };
    radek.platici = radek.platil_kc > 0;
    radek.skoda = radek.sleva;
    radek.zmrazit = Math.round(radek.skoda * R.koef_zabaveni);
    radek.trest = { nejnizsi: Math.round(radek.skoda * R.trest_nejnizsi), stredni: Math.round(radek.skoda * R.trest_stredni), nejvyssi: Math.round(radek.skoda * R.trest_nejvyssi) };
    radek.utvar = 'Celní správa'; radek.stav = 'kontrola';
    vysledek.push(radek);
  });
  const rad = (a, b) => b.skoda - a.skoda;
  vysledek.sort(rad); nahled.sort(rad);
  return {
    pravidla: R, celkem_hracu: hraci.length,
    kontrola: vysledek, na_hrane: nahled,
    souhrn: { kontrol: vysledek.length, skoda: vysledek.reduce((a, x) => a + x.skoda, 0), zmrazit: vysledek.reduce((a, x) => a + x.zmrazit, 0) },
  };
}

module.exports = { nastaveni, uloz, nanecisto, VYCHOZI };
