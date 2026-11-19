// =============================================================================
// HolyOS — Laundromat Tycoon: řízení zločinu (kontrola → soud → odvolání)
// =============================================================================
// Případ otevírá vyhodnocení z zlocin.js (když jsou pravidla zapnutá) a dál ho
// posouvá čas:
//   kontrola (1 herní měsíc)  → soud (porota hlasuje)  → odvolání (lhůta)  → uzavřeno
// Při zahájení se hotovost zmrazí: odečte se doručenkou a drží ji případ.
// Po rozsudku má obviněný lhůtu na odvolání. Bez odvolání rozsudek nabude
// účinnosti sám, s odvoláním čeká na ruční rozhodnutí v administraci.
// Každá změna stavu = zpráva v „novinách" (všichni hráči).
// =============================================================================
'use strict';

const ZL = require('./zlocin');
const MESIC_MS = 43200000;               // herní měsíc = 12 skutečných hodin
const TIK_MS = 5 * 60 * 1000;
const AKTIVNI = ['kontrola', 'soud', 'odvolani'];
const UROVNE = ['nejnizsi', 'stredni', 'nejvyssi'];
const L = (n) => Math.round(Number(n) || 0).toLocaleString('cs-CZ') + ' L$';
const jmeno = (z) => z.firma || z.hlavni_nick;

async function zprava(prisma, z, nadpis, text) {
  await prisma.gameZlocinZprava.create({ data: {
    zlocin_id: z.id, nadpis: String(nadpis).slice(0, 160), text: String(text).slice(0, 600),
    emblem: z.emblem || null, stav: z.stav || null } });
}

async function dorucenka(prisma, playerId, amount, popis) {
  if (!amount) return;
  await prisma.gameDelivery.create({ data: { player_id: playerId, kind: 'cash', amount: Math.round(amount), popis: String(popis).slice(0, 200) } });
}

function podezreni(z) {
  return z.typ === 'kupec'
    ? 'skupování prádlomatů od zrušených účtů hluboko pod cenou'
    : 'provize z účelově založených a zrušených účtů';
}

// Otevře případ z řádku vyhodnocení.
async function zahaj(prisma, R, row) {
  const h = await prisma.gamePlayer.findUnique({ where: { id: row.id }, select: { state: true, company: true, nick: true } });
  if (!h) return null;
  const cash = Math.max(0, Math.round(((h.state || {}).cash) || 0));
  const zmrazeno = Math.min(row.zmrazit || 0, cash);
  const ted = new Date();
  const z = await prisma.gameZlocin.create({ data: {
    hlavni_id: row.id, hlavni_nick: row.nick, firma: h.company || row.firma || null, typ: row.typ === 'kupec' ? 'kupec' : 'zvouci',
    utvar: row.utvar, emblem: row.emblem || null, stav: 'kontrola', skoda: row.skoda, zmrazeno,
    kontrola_do: new Date(ted.getTime() + R.kontrola_mesicu * MESIC_MS),
    detail: { pod_ids: row.pod_ids || [], provize: row.provize, sleva: row.sleva, zmrazit_cil: row.zmrazit, platici: !!row.platici },
  } });
  if (zmrazeno > 0) await dorucenka(prisma, row.id, -zmrazeno, 'Zmrazeno kvůli kontrole (' + row.utvar + '): ' + L(zmrazeno));
  await zprava(prisma, z, (z.emblem || '') + ' Kontrola firmy ' + jmeno(z),
    row.utvar + ' zahájila kontrolu firmy ' + jmeno(z) + '. Podezření: ' + podezreni(z) + '. Odhadovaná škoda ' + L(z.skoda)
    + '. Kontrola potrvá 1 herní měsíc, majetek firmy je zmrazen.');
  return z;
}

// Kdo smí hlasovat v případu.
async function smiHlasovat(prisma, R, hrac, z) {
  if (!hrac || hrac.id === z.hlavni_id) return { ok: false, duvod: 'obviněný' };
  // Jediné pravidlo: účet starší než zadaný čas (výchozí 24 h). Hlasovat není povinnost.
  const ted = Date.now();
  if (new Date(hrac.created_at).getTime() > ted - R.porotce_min_mesicu * MESIC_MS) return { ok: false, duvod: 'účet je mladší než ' + Math.round(R.porotce_min_mesicu * 12) + ' h' };
  return { ok: true };
}

async function hlasuj(prisma, hracId, zlocinId, volba) {
  if (!UROVNE.includes(volba)) return { ok: false, error: 'Neplatná volba.' };
  const R = await ZL.nastaveni();
  const z = await prisma.gameZlocin.findUnique({ where: { id: zlocinId } });
  if (!z || z.stav !== 'soud' || (z.soud_do && new Date(z.soud_do) < new Date())) return { ok: false, error: 'Hlasování už neběží.' };
  const hrac = await prisma.gamePlayer.findUnique({ where: { id: hracId }, select: { id: true, created_at: true, last_login_at: true } });
  const s = await smiHlasovat(prisma, R, hrac, z);
  if (!s.ok) return { ok: false, error: 'V tomto případu nemůžeš hlasovat (' + s.duvod + ').' };
  await prisma.gameZlocinHlas.upsert({ where: { zlocin_id_player_id: { zlocin_id: z.id, player_id: hracId } },
    create: { zlocin_id: z.id, player_id: hracId, volba }, update: { volba } });
  return { ok: true };
}

async function odvolej(prisma, hracId, zlocinId, text) {
  const z = await prisma.gameZlocin.findUnique({ where: { id: zlocinId } });
  if (!z || z.hlavni_id !== hracId) return { ok: false, error: 'Případ nenalezen.' };
  if (z.stav !== 'odvolani' || z.odvolani_at || !z.odvolani_do || new Date(z.odvolani_do) < new Date()) return { ok: false, error: 'Odvolat se už nelze.' };
  const t = String(text || '').trim().slice(0, 1000);
  if (t.length < 10) return { ok: false, error: 'Napiš aspoň stručné zdůvodnění odvolání.' };
  const u = await prisma.gameZlocin.update({ where: { id: z.id }, data: { odvolani_text: t, odvolani_at: new Date() } });
  await zprava(prisma, u, '📄 Odvolání firmy ' + jmeno(u), 'Firma ' + jmeno(u) + ' se odvolala proti rozsudku. Majetek zůstává zmrazen, dokud o odvolání nerozhodne správa hry.');
  return { ok: true };
}

// Rozsudek z hlasů poroty.
async function verdikt(prisma, R, z) {
  const hlasy = await prisma.gameZlocinHlas.findMany({ where: { zlocin_id: z.id } });
  const pocty = { nejnizsi: 0, stredni: 0, nejvyssi: 0 };
  hlasy.forEach((h) => { if (pocty[h.volba] != null) pocty[h.volba]++; });
  let uroven = 'stredni', pozn = '';
  const max = Math.max(pocty.nejnizsi, pocty.stredni, pocty.nejvyssi);
  const vitezu = UROVNE.filter((u) => pocty[u] === max);
  // Počet hlasujících nehraje roli: hlasování se uzavře po lhůtě, rozhoduje většina
  if (!hlasy.length) pozn = 'Nikdo nehlasoval, platí střední trest.';
  else if (vitezu.length === 1) uroven = vitezu[0];
  else pozn = 'Hlasy se rozdělily nerozhodně, platí střední trest.';
  const koef = R['trest_' + uroven];
  const castka = Math.round(z.skoda * koef);
  const odvolani_do = new Date(Date.now() + R.odvolani_mesicu * MESIC_MS);
  const u = await prisma.gameZlocin.update({ where: { id: z.id }, data: {
    stav: 'odvolani', trest_uroven: uroven, trest_castka: castka, odvolani_do,
    detail: Object.assign({}, z.detail || {}, { hlasy: pocty, hlasu: hlasy.length, pozn }) } });
  await zprava(prisma, u, '⚖️ Rozsudek: firma ' + jmeno(u),
    'Soud a porota rozhodly: firmě ' + jmeno(u) + ' se ukládá trest ' + L(castka) + ' (škoda ' + L(u.skoda) + ' × ' + koef + '). '
    + 'Hlasy: ' + pocty.nejnizsi + '/' + pocty.stredni + '/' + pocty.nejvyssi + '. ' + pozn
    + ' Obviněný má 1 herní měsíc na odvolání, do té doby je majetek zmrazen.');
  return u;
}

// Rozsudek nabývá účinnosti: strhne se trest a vrátí přebytek zmrazené částky.
async function uzavri(prisma, z, rozhodnuti, castka) {
  const trest = Math.max(0, Math.round(castka != null ? castka : (z.trest_castka || 0)));
  const zm = z.zmrazeno || 0;
  let nedoplatek = 0;
  if (zm > trest) await dorucenka(prisma, z.hlavni_id, zm - trest, 'Soud: vráceno ze zmrazené částky ' + L(zm - trest));
  else if (trest > zm) {
    const h = await prisma.gamePlayer.findUnique({ where: { id: z.hlavni_id }, select: { state: true } });
    const cash = Math.max(0, Math.round(((h && h.state) || {}).cash || 0));
    const dopl = trest - zm;
    const zHotovosti = Math.min(dopl, cash);
    let zbyva = dopl - zHotovosti;
    if (zHotovosti > 0) await dorucenka(prisma, z.hlavni_id, -zHotovosti, 'Soud: doplatek trestu ' + L(zHotovosti));
    // Nestačí hotovost → propadnou prádlomaty (od nejlevnějšího, dokud se trest nepokryje).
    // Zabavený majetek mizí ze hry: nikomu se nepřevádí, místo se uvolní.
    if (zbyva > 0) {
      const claims = await prisma.gameSpotClaim.findMany({ where: { player_id: z.hlavni_id } });
      const sCenou = claims.map((c) => ({ c, v: ZL.cenik(c.model) })).sort((a, b) => a.v - b.v);
      const zabaveno = [];
      for (const x of sCenou) {
        if (zbyva <= 0) break;
        await prisma.gameDelivery.create({ data: { player_id: z.hlavni_id, kind: 'unit_remove', spot_id: x.c.spot_id,
          popis: 'Soud: zabaven prádlomat ' + (x.c.name || x.c.spot_id) + ' (propadl státu)' } });
        await prisma.gameSpotClaim.deleteMany({ where: { spot_id: x.c.spot_id, player_id: z.hlavni_id } });
        zabaveno.push(x.c.name || x.c.spot_id);
        zbyva -= x.v;
      }
      nedoplatek = Math.max(0, Math.round(zbyva));
      if (zabaveno.length) z.zabaveno_stroju = zabaveno;
    }
  }
  const u = await prisma.gameZlocin.update({ where: { id: z.id }, data: {
    stav: 'uzavreno', uzavreno_at: new Date(), trest_castka: trest, nedoplatek, admin_rozhodnuti: rozhodnuti || null } });
  await zprava(prisma, u, '✅ Případ ' + jmeno(u) + ' uzavřen',
    'Rozsudek proti firmě ' + jmeno(u) + ' nabyl účinnosti. Odebráno ' + L(trest) + '. Zabavené peníze i majetek propadly a zmizely ze hry.'
    + (z.zabaveno_stroju && z.zabaveno_stroju.length ? ' Propadlo ' + z.zabaveno_stroju.length + ' prádlomatů.' : '')
    + (nedoplatek > 0 ? ' Nedoplatek ' + L(nedoplatek) + ' zůstává dluhem.' : ''));
  return u;
}

async function zrus(prisma, z, poznamka) {
  if ((z.zmrazeno || 0) > 0) await dorucenka(prisma, z.hlavni_id, z.zmrazeno, 'Případ zrušen: vráceno ' + L(z.zmrazeno));
  const u = await prisma.gameZlocin.update({ where: { id: z.id }, data: {
    stav: 'zruseno', uzavreno_at: new Date(), admin_rozhodnuti: 'zruseno', admin_poznamka: poznamka ? String(poznamka).slice(0, 500) : null } });
  await zprava(prisma, u, '🚫 Případ ' + jmeno(u) + ' zrušen', 'Řízení proti firmě ' + jmeno(u) + ' bylo zrušeno. Zmrazený majetek je vrácen.');
  return u;
}

let bezi = false;
async function tik() {
  if (bezi) return;
  bezi = true;
  try {
    const { prisma } = require('../../config/database');
    const R = await ZL.nastaveni();
    const ted = new Date();
    // 1) posun stávajících případů
    const aktivni = await prisma.gameZlocin.findMany({ where: { stav: { in: AKTIVNI } } });
    for (const z of aktivni) {
      try {
        if (z.stav === 'kontrola' && ted >= z.kontrola_do) {
          const u = await prisma.gameZlocin.update({ where: { id: z.id }, data: { stav: 'soud', soud_do: new Date(ted.getTime() + R.soud_mesicu * MESIC_MS) } });
          await zprava(prisma, u, '⚖️ Soud s firmou ' + jmeno(u),
            'Kontrola firmy ' + jmeno(u) + ' skončila, případ jde k soudu. Škoda ' + L(u.skoda) + '. Porota hlasuje o trestu 1 herní měsíc — v noviny můžeš hlasovat, pokud máš účet starší než ' + (R.porotce_min_mesicu * 12) + ' hodin.');
        } else if (z.stav === 'soud' && z.soud_do && ted >= z.soud_do) {
          await verdikt(prisma, R, z);
        } else if (z.stav === 'odvolani' && !z.odvolani_at && z.odvolani_do && ted >= z.odvolani_do) {
          await uzavri(prisma, z, 'automaticky');
        }
      } catch (e) { console.warn('[zlocin] případ #' + z.id + ':', e && e.message); }
    }
    // 2) nové případy z vyhodnocení (jen když jsou pravidla zapnutá)
    if (R.zapnuto) {
      const v = await ZL.nanecisto(prisma, R);
      const mam = new Set((await prisma.gameZlocin.findMany({ select: { hlavni_id: true } })).map((x) => x.hlavni_id));
      let n = 0;
      for (const row of v.kontrola) {
        if (n >= R.max_novych_za_tik) break;
        if (mam.has(row.id)) continue;
        await zahaj(prisma, R, row); n++;
      }
    }
  } catch (e) {
    console.warn('[zlocin] tik:', e && e.message);
  } finally { bezi = false; }
}

function start() {
  setTimeout(tik, 45000);
  setInterval(tik, TIK_MS);
  console.log('[zlocin] řízení kontrol a soudů běží');
}

async function aktivniPripad(prisma, playerId) {
  return prisma.gameZlocin.findFirst({ where: { hlavni_id: playerId, stav: { in: AKTIVNI } } });
}

module.exports = { start, tik, zahaj, hlasuj, odvolej, verdikt, uzavri, zrus, smiHlasovat, aktivniPripad, AKTIVNI, UROVNE, MESIC_MS };
