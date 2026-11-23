// =============================================================================
// Laundromat Tycoon — analytik: hledá finty, na které detektory nestačí
// =============================================================================
// Detektory v agentovi umí čtyři vzorce, které známe. Hráči ale vymýšlejí
// nové a nikdo je nestíhá hledat ručně. Tohle projde hru, udělá z ní přehled
// a nechá ho přečíst modelu: co je na těch číslech divné a nedá se to
// vysvětlit poctivou hrou?
//
// DŮLEŽITÉ: analytik NIC nezahajuje a nic netrestá. Jeho výstup je návrh pro
// člověka — text od modelu je vstupní data, ne příkaz. Případ pořád otevírá
// buď admin tlačítkem, nebo detektor, který se podle návrhu teprve napíše.
// Proto se jeho nálezy ani nepředávají řízení: čte je člověk a rozhodne.
//
// Podklad je schválně souhrn, ne výpis všeho. Celá databáze by se do zadání
// nevešla a model by se v ní ztratil — zajímají nás krajnosti: kam teče
// nejvíc hodnoty, kdo skoro nehraje a přesto velké částky posílá, co se
// prodává daleko od ceníku.
'use strict';

const { getSetting, setSetting } = require('../settings');
const KLIC = 'game.zlocin_analyza';
const MODEL = process.env.GAME_ANALYTIK_MODEL || 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 4000;
const PODKLAD_MAX = 24000;      // znaků — dál už se model jen topí v datech

const LIST = { mini: Math.round(35000 * 24.35 * 1.25), flex: Math.round(52000 * 24.35 * 1.25), max: Math.round(67000 * 24.35 * 1.25) };
const cenik = (m) => LIST[String(m || '').toLowerCase()] || LIST.mini;
const kc = (n) => Math.round(Number(n) || 0).toLocaleString('cs-CZ');
const orez = (s, n) => String(s == null ? '' : s).slice(0, n);

// ─── Podklad ─────────────────────────────────────────────────────────────────
async function podklady(prisma) {
  const [hraci, obchody, drazby, prihozy, pujcky, equity, aliance, clenove, mista, market] = await Promise.all([
    prisma.gamePlayer.findMany({ select: { id: true, nick: true, company: true, created_at: true,
      hra_s_celkem: true, disabled: true, invited_by_id: true, state: true } }),
    prisma.gameTrade.findMany({ where: { stav: 'prijato' },
      select: { id: true, from_id: true, to_id: true, smer: true, predmet: true, model: true, cena: true, resolved_at: true } }),
    prisma.gameDrazba.findMany({ where: { stav: 'hotovo' },
      select: { id: true, prodavajici_id: true, nazev: true, suma: true, cena: true, vitez_id: true, prihozu: true } }),
    prisma.gameDrazbaPrihoz.findMany({ select: { drazba_id: true, player_id: true, castka: true } }),
    prisma.gameLoan.findMany({ select: { id: true, lender_id: true, borrower_id: true, castka: true,
      splatka: true, splaceno: true, mesicu: true, stav: true, zastava_spot: true } }),
    prisma.gameEquity.findMany({ select: { id: true, investor_id: true, fond_id: true, firma_id: true,
      podil: true, cena: true, stav: true } }),
    prisma.gameAliance.findMany({ select: { id: true, nazev: true, pokladna: true } }).catch(() => []),
    prisma.gameAlianceClen.findMany({ where: { stav: 'clen' }, select: { aliance_id: true, player_id: true } }).catch(() => []),
    prisma.gameSpotClaim.groupBy({ by: ['player_id'], _count: { _all: true } }).catch(() => []),
    prisma.gameMarket.findMany({ where: { koupil_id: { not: null } },
      select: { id: true, player_id: true, koupil_id: true, cena: true, model: true, name: true } }).catch(() => []),
  ]);

  const P = new Map(hraci.map((h) => [h.id, h]));
  const jm = (id) => { const h = P.get(id); return h ? (h.nick || ('#' + id)) : ('#' + id); };
  const hotovost = (h) => Math.round(((h.state || {}).cash) || 0);
  const strojuMap = new Map(mista.map((m) => [m.player_id, m._count._all]));

  // Tok hodnoty mezi dvojicemi účtů: obchody, dražby, tržiště, půjčky.
  const tok = new Map();   // "a>b" → { ks, castka, pomer: [] }
  const pridejTok = (od, komu, castka, pomer) => {
    if (!od || !komu || od === komu) return;
    const k = od + '>' + komu;
    const t = tok.get(k) || { od, komu, ks: 0, castka: 0, pomery: [] };
    t.ks++; t.castka += Math.round(castka || 0);
    if (pomer != null) t.pomery.push(pomer);
    tok.set(k, t);
  };
  obchody.forEach((t) => {
    const prod = t.smer === 'koupim' ? t.to_id : t.from_id;
    const kup = t.smer === 'koupim' ? t.from_id : t.to_id;
    const fer = ['stroj', 'pradlomat'].indexOf(t.predmet) >= 0 ? cenik(t.model) : 0;
    pridejTok(kup, prod, t.cena, fer ? Math.round((Number(t.cena) || 0) / fer * 100) : null);
  });
  market.forEach((m) => pridejTok(m.koupil_id, m.player_id, m.cena,
    m.model ? Math.round((Number(m.cena) || 0) / cenik(m.model) * 100) : null));

  const topTok = [...tok.values()].sort((a, b) => b.castka - a.castka).slice(0, 15);

  // Krátce hrající účty, přes které tečou peníze.
  const poslal = new Map(), prijal = new Map();
  tok.forEach((t) => {
    poslal.set(t.od, (poslal.get(t.od) || 0) + t.castka);
    prijal.set(t.komu, (prijal.get(t.komu) || 0) + t.castka);
  });
  const kratke = hraci
    .map((h) => ({ h, min: Math.round((h.hra_s_celkem || 0) / 60),
      pohyb: (poslal.get(h.id) || 0) + (prijal.get(h.id) || 0) }))
    .filter((x) => x.min < 120 && x.pohyb > 1000000)
    .sort((a, b) => b.pohyb - a.pohyb).slice(0, 12);

  // Obchody daleko od ceníku.
  const divne = obchody
    .filter((t) => ['stroj', 'pradlomat'].indexOf(t.predmet) >= 0)
    .map((t) => {
      const prod = t.smer === 'koupim' ? t.to_id : t.from_id;
      const kup = t.smer === 'koupim' ? t.from_id : t.to_id;
      const pom = Math.round((Number(t.cena) || 0) / cenik(t.model) * 100);
      return { id: t.id, prod, kup, cena: Number(t.cena) || 0, pom };
    })
    .filter((x) => x.pom < 50 || x.pom > 200)
    .sort((a, b) => Math.abs(b.pom - 100) - Math.abs(a.pom - 100)).slice(0, 12);

  // Dražby: kolik v nich nechali ti, kdo nevyhráli.
  const podleDrazby = new Map();
  prihozy.forEach((p) => {
    const l = podleDrazby.get(p.drazba_id) || []; l.push(p); podleDrazby.set(p.drazba_id, l);
  });
  const drazbyTop = drazby.map((d) => {
    const l = podleDrazby.get(d.id) || [];
    const prihazujicich = new Set(l.map((x) => x.player_id)).size;
    return { d, suma: l.reduce((a, x) => a + (x.castka || 0), 0), prihazujicich };
  }).sort((a, b) => b.suma - a.suma).slice(0, 10);

  // Půjčky, které se nesplácejí.
  const spatne = pujcky.filter((p) => p.stav === 'propadlo' || p.stav === 'vymahano')
    .sort((a, b) => b.castka - a.castka).slice(0, 10);

  // Fondy a jejich členové.
  const fondy = aliance.map((a) => {
    const cl = clenove.filter((c) => c.aliance_id === a.id).map((c) => c.player_id);
    const drzi = equity.filter((e) => e.fond_id === a.id && e.stav === 'bezi');
    return { a, cl, drzi, odClenu: drzi.filter((e) => cl.indexOf(e.firma_id) >= 0) };
  }).sort((a, b) => b.drzi.length - a.drzi.length).slice(0, 8);

  const radky = [];
  const sekce = (n) => radky.push('', '── ' + n + ' ' + '─'.repeat(Math.max(0, 60 - n.length)));

  radky.push('HRA K ' + new Date().toISOString().slice(0, 16).replace('T', ' '));
  radky.push('hráčů ' + hraci.length + ' (zablokovaných ' + hraci.filter((h) => h.disabled).length
    + '), obchodů ' + obchody.length + ', dražeb ' + drazby.length
    + ', půjček ' + pujcky.length + ', podílů ' + equity.length + ', prodejů z tržiště ' + market.length);

  sekce('KAM TEČE NEJVÍC HODNOTY (dvojice účtů, kupující → prodávající)');
  topTok.forEach((t) => {
    const pom = t.pomery.length ? Math.round(t.pomery.reduce((a, x) => a + x, 0) / t.pomery.length) : null;
    radky.push(jm(t.od) + ' → ' + jm(t.komu) + ': ' + t.ks + '× za ' + kc(t.castka) + ' L$'
      + (pom != null ? ', průměrně ' + pom + ' % ceníku' : ''));
  });

  sekce('ÚČTY, KTERÉ SKORO NEHRAJÍ, A PŘESTO JIMI TEČOU PENÍZE');
  kratke.forEach((x) => radky.push(x.h.nick + ': odehráno ' + x.min + ' min, pohyb ' + kc(x.pohyb)
    + ' L$, hotovost ' + kc(hotovost(x.h)) + ' L$, strojů ' + (strojuMap.get(x.h.id) || 0)
    + (x.h.invited_by_id ? ', pozval ho ' + jm(x.h.invited_by_id) : '')
    + (x.h.disabled ? ', ZABLOKOVANÝ' : '')));

  sekce('OBCHODY DALEKO OD CENÍKU');
  divne.forEach((x) => radky.push('#' + x.id + ': ' + jm(x.prod) + ' → ' + jm(x.kup)
    + ' za ' + kc(x.cena) + ' L$ = ' + x.pom + ' % ceníku'));

  sekce('DRAŽBY S NEJVĚTŠÍMI PŘÍHOZY');
  drazbyTop.forEach((x) => radky.push('#' + x.d.id + ' „' + orez(x.d.nazev, 40) + '": prodávající '
    + jm(x.d.prodavajici_id) + ', příhozů ' + kc(x.suma) + ' L$ od ' + x.prihazujicich
    + ' hráčů, vyhrál ' + (x.d.vitez_id ? jm(x.d.vitez_id) : 'nikdo')));

  sekce('PŮJČKY, KTERÉ SE NESPLATILY');
  spatne.forEach((p) => radky.push('#' + p.id + ': ' + jm(p.lender_id) + ' → ' + jm(p.borrower_id)
    + ', ' + kc(p.castka) + ' L$, splaceno ' + (p.splaceno || 0) + '/' + (p.mesicu || 0)
    + ' splátek, stav ' + p.stav + (p.zastava_spot ? ', zástava ' + p.zastava_spot : '')));

  sekce('FONDY');
  fondy.forEach((f) => radky.push('„' + orez(f.a.nazev, 30) + '": členů ' + f.cl.length
    + ', pokladna ' + kc(f.a.pokladna) + ' L$, drží podíly v ' + f.drzi.length + ' firmách'
    + (f.odClenu.length ? ', z toho ' + f.odClenu.length + ' ve firmách vlastních členů' : '')));

  return radky.join('\n').slice(0, PODKLAD_MAX);
}

// ─── Zadání pro model ────────────────────────────────────────────────────────
const SYSTEM = [
  'Jsi vyšetřovatel v ekonomické hře Laundromat Tycoon. Hráči v ní staví síť prádlomatů,',
  'obchodují spolu, draží, půjčují si a skládají se do fondů.',
  '',
  'Dostaneš souhrn hry. Tvůj úkol je najít CHOVÁNÍ, KTERÉ SE NEDÁ VYSVĚTLIT POCTIVOU HROU —',
  'tedy způsoby, jak někdo získává hodnotu, kterou do hry nevložil: přelévání peněz mezi',
  'vlastními účty, nastrčené protistrany, zneužití společné kasy, umělé šroubování cen.',
  '',
  'Pravidla:',
  '· Vycházej JEN z čísel, která jsi dostal. Nic si nedomýšlej a nevymýšlej jména ani částky.',
  '· Jeden divný údaj nestačí. Napiš nález jen tehdy, když ho drží víc čísel zároveň.',
  '· Hledej NOVÉ vzorce. Co už hlídají detektory (seznam je v zadání), neopakuj.',
  '· U každého nálezu řekni, jak se dá OVĚŘIT, a odhadni škodu — nebo napiš, že ji ze',
  '  souhrnu odhadnout nejde. Nadsazený odhad je horší než žádný.',
  '· Běžná hra není podvod: velký hráč obchoduje hodně, rodina může hrát z jednoho bytu,',
  '  levný prodej kamarádovi je legitimní dárek. Rozlišuj.',
  '',
  'Odpověz POUZE platným JSON:',
  '{"nalezy":[{"nazev":"<krátce>","popis":"<co se děje, 2–4 věty>","koho":["<nick>"],',
  '"proc_podezrele":"<co to drží>","jak_overit":"<konkrétní krok>","odhad_skody":<číslo nebo null>,',
  '"jistota":"nízká|střední|vysoká","navrh_detektoru":"<jak by se to dalo hlídat automaticky>"}],',
  '"poznamka":"<co jsi NEnašel nebo co ti v datech chybí>"}',
  'Piš česky. Když nic nenajdeš, vrať prázdné pole — to je platný výsledek.',
].join('\n');

const UZ_HLIDAME = [
  'obchody mezi účty jednoho člověka za cenu mimo ceník (pod 60 % nebo nad 160 % ceníku)',
  'přihazování na vlastní dražbu z druhého účtu',
  'prodej podílu do společného fondu přes účet, který v tom fondu sedí',
  'půjčky mezi vlastními účty, které se nesplácejí',
  'provize z účelově založených a zrušených účtů (zvoucí)',
  'skupování strojů od zrušených účtů hluboko pod cenou (kupec)',
].map((x) => '· ' + x).join('\n');

function rozparsuj(text) {
  const s = String(text || '').trim();
  const zac = s.indexOf('{'), kon = s.lastIndexOf('}');
  if (zac < 0 || kon <= zac) return null;
  try { return JSON.parse(s.slice(zac, kon + 1)); } catch (e) { return null; }
}

// Výstup modelu je DATA, ne příkaz. Projde se stejně přísně jako cokoli, co
// přijde zvenčí: ořeže se délka, zahodí se, co nesedí do tvaru.
function ocisti(j) {
  const n = (j && Array.isArray(j.nalezy)) ? j.nalezy : [];
  return {
    nalezy: n.slice(0, 12).map((x) => ({
      nazev: orez(x && x.nazev, 120),
      popis: orez(x && x.popis, 800),
      koho: (Array.isArray(x && x.koho) ? x.koho : []).slice(0, 10).map((y) => orez(y, 40)),
      proc_podezrele: orez(x && x.proc_podezrele, 600),
      jak_overit: orez(x && x.jak_overit, 400),
      odhad_skody: Number.isFinite(Number(x && x.odhad_skody)) ? Math.round(Number(x.odhad_skody)) : null,
      jistota: ['nízká', 'střední', 'vysoká'].indexOf(x && x.jistota) >= 0 ? x.jistota : 'nízká',
      navrh_detektoru: orez(x && x.navrh_detektoru, 500),
    })).filter((x) => x.nazev),
    poznamka: orez(j && j.poznamka, 800),
  };
}

async function posledni() {
  const v = await getSetting(KLIC, { type: 'json', defaultValue: null }).catch(() => null);
  return (v && typeof v === 'object') ? v : null;
}

async function analyzuj(prisma) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY není na serveru nastavený — bez něj analytik nepoběží.' };
  const podklad = await podklady(prisma);
  const Anthropic = require('@anthropic-ai/sdk');
  const { messagesCreate, humanizeAiError } = require('../anthropic-retry');
  const client = new Anthropic({ apiKey });
  try {
    const resp = await messagesCreate(client, {
      model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM,
      messages: [{ role: 'user', content: 'CO UŽ HLÍDAJÍ DETEKTORY (tohle nehledej znovu):\n'
        + UZ_HLIDAME + '\n\nSOUHRN HRY:\n' + podklad }],
    }, { label: 'game-zlocin-analytik' });
    const text = ((resp && resp.content) || []).filter((c) => c && c.type === 'text')
      .map((c) => c.text).join('\n');
    const j = ocisti(rozparsuj(text));
    if (!j) return { ok: false, error: 'Model neodpověděl ve tvaru, kterému rozumím.' };
    const ven = { kdy: new Date().toISOString(), model: MODEL,
      nalezu: j.nalezy.length, nalezy: j.nalezy, poznamka: j.poznamka,
      tokeny: (resp && resp.usage) ? { vstup: resp.usage.input_tokens, vystup: resp.usage.output_tokens } : null };
    await setSetting(KLIC, ven, { type: 'json',
      description: 'Laundromat Tycoon — poslední analýza hledající nové finty', scope: 'game' })
      .catch(() => {});
    return Object.assign({ ok: true }, ven);
  } catch (e) {
    console.warn('[zlocin-analytik]', e && e.message);
    return { ok: false, error: (humanizeAiError ? humanizeAiError(e) : null) || (e && e.message) || 'Analytik teď není k dispozici.' };
  }
}

module.exports = { analyzuj, posledni, podklady, ocisti, rozparsuj, SYSTEM, UZ_HLIDAME, MODEL, KLIC };
