// =============================================================================
// HolyOS — Laundromat Tycoon: agent nad zločinem
// =============================================================================
// Pevná pravidla uměla dva vzorce (zvoucí, kupec). Agent hledá další čtyři:
// obchody mezi účty jednoho člověka, přihazování na vlastní dražbu, prodej
// podílu do společného fondu přes spojený účet a půjčky, co se nesplácejí.
//
// Agent zahajuje řízení sám, takže falešný nález znamená zmrazený majetek
// nevinnému hráči. Proto se tu hlídá obojí: že najde, co najít má, a že
// nenajde to, co je v pořádku — rodina na jednom počítači, poctivý obchod,
// splacená půjčka.
// =============================================================================
'use strict';

const path = require('path');
const SP = require(path.join(__dirname, '..', 'services/game/spojeni'));
const A = require(path.join(__dirname, '..', 'services/game/zlocin-agent'));

let chyb = 0;
function ma(podminka, popis, detail) {
  if (podminka) { console.log('  ok   ' + popis + (detail ? '  — ' + detail : '')); return; }
  chyb++; console.log('  CHYBA ' + popis + (detail ? '  — ' + detail : ''));
}

const R = Object.assign({}, A.VYCHOZI, { koef_zabaveni: 1.2, trest_nejnizsi: 1, trest_stredni: 1.2, trest_nejvyssi: 1.3 });
const HRACI = [
  { id: 1, nick: 'Hlavni', company: 'Hlavní s.r.o.' },
  { id: 2, nick: 'Pomocny', company: 'Pomocná s.r.o.' },
  { id: 3, nick: 'Cizi', company: 'Cizí s.r.o.' },
  { id: 4, nick: 'Rodina', company: 'Rodina s.r.o.', reg_ip: '1.2.3.4' },
  { id: 5, nick: 'RodinaB', company: 'Rodina B s.r.o.', reg_ip: '1.2.3.4' },
];
// 1 a 2 je jeden člověk (stejný otisk prohlížeče), 4 a 5 jen stejná IP.
const T = Date.now();
const PRISTUPY = [
  { player_id: 1, druh: 'hra', fp: 'FP-A', dev: 'DEV-A', created_at: new Date(T) },
  { player_id: 2, druh: 'hra', fp: 'FP-A', dev: 'DEV-A', created_at: new Date(T + 1000) },
  { player_id: 3, druh: 'hra', fp: 'FP-C', dev: 'DEV-C', created_at: new Date(T) },
];
const S = SP.postav(HRACI, PRISTUPY);
const CENA_MAX = A.cenik('max');

// ─── Spojení samo o sobě ────────────────────────────────────────────────────
{
  console.log('\nKdo je jeden člověk');
  ma(S.jedenClovek(1, 2), 'stejný otisk prohlížeče = jeden člověk', S.sila(1, 2));
  ma(!S.jedenClovek(1, 3), 'cizí hráč ne');
  ma(!S.jedenClovek(4, 5), 'rodina na jedné IP ne — to je slabý signál', S.sila(4, 5));
  ma(S.popis(1, 2).length > 0, 'spojení se dá popsat větou', S.popis(1, 2));
}

// ─── 1) Obchody mezi vlastními účty ─────────────────────────────────────────
{
  console.log('\nObchody mezi vlastními účty');
  const d = { obchody: [
    // hlavní koupil od svého účtu stroj za desetinu ceníku
    { id: 11, from_id: 1, to_id: 2, smer: 'koupim', predmet: 'stroj', model: 'max', cena: Math.round(CENA_MAX * 0.1) },
    // a jeden poctivý nákup od cizího
    { id: 12, from_id: 1, to_id: 3, smer: 'koupim', predmet: 'stroj', model: 'max', cena: Math.round(CENA_MAX * 0.1) },
    // rodina mezi sebou — slabé spojení, nestíháme
    { id: 13, from_id: 4, to_id: 5, smer: 'koupim', predmet: 'stroj', model: 'max', cena: 1 },
    // prodej svému účtu za trojnásobek — odsávání hotovosti
    { id: 14, from_id: 1, to_id: 2, smer: 'prodam', predmet: 'pradlomat', model: 'mini', cena: Math.round(A.cenik('mini') * 3) },
  ] };
  const n = A.spojeneObchody(d, S, R);
  const hlavni = n.filter((x) => x.id === 1)[0];
  ma(!!hlavni, 'nález na hlavním účtu je');
  ma(n.length === 1, 'a jenom na něm', n.map((x) => x.id).join(','));
  const ocek = (CENA_MAX - Math.round(CENA_MAX * 0.1)) + (Math.round(A.cenik('mini') * 3) - A.cenik('mini'));
  ma(hlavni.skoda === ocek, 'škoda je rozdíl proti ceníku, obojí dohromady', hlavni.skoda + ' / ' + ocek);
  ma(hlavni.dukazy.length === 2, 'oba obchody jsou doložené', hlavni.dukazy.length);
  ma(hlavni.dukazy.some((x) => x.obchod === 11) && hlavni.dukazy.some((x) => x.obchod === 14), 'a jsou to ty správné');
  ma(!hlavni.dukazy.some((x) => x.obchod === 12), 'nákup od cizího se nepočítá');

  // Obchod za rozumnou cenu mezi vlastními účty není škoda — přesouvat
  // majetek mezi svými firmami hra dovoluje.
  const ok = A.spojeneObchody({ obchody: [
    { id: 20, from_id: 1, to_id: 2, smer: 'koupim', predmet: 'stroj', model: 'max', cena: CENA_MAX },
    { id: 21, from_id: 1, to_id: 2, smer: 'koupim', predmet: 'stroj', model: 'max', cena: Math.round(CENA_MAX * 0.8) },
  ] }, S, R);
  ma(!ok.length, 'obchod za cenu blízkou ceníku se nehlásí');
  // Co neumíme ocenit, nesoudíme.
  const neocenitelne = A.spojeneObchody({ obchody: [
    { id: 22, from_id: 1, to_id: 2, smer: 'koupim', predmet: 'podil', cena: 50000000 },
  ] }, S, R);
  ma(!neocenitelne.length, 'podíl bez ceníku se nehlásí');
}

// ─── 2) Dražby naoko ────────────────────────────────────────────────────────
{
  console.log('\nPřihazování na vlastní dražbu');
  const d = {
    drazby: [
      { id: 31, prodavajici_id: 1, nazev: 'prádlomat Lidl' },
      { id: 32, prodavajici_id: 1, nazev: 'poctivá dražba' },
      { id: 33, prodavajici_id: 3, nazev: 'cizí dražba' },
    ],
    prihozy: [
      // 31: přihazoval i vlastní účet, cizí tam nechal 900 000
      { drazba_id: 31, player_id: 2, nick: 'Pomocny', castka: 500000 },
      { drazba_id: 31, player_id: 3, nick: 'Cizi', castka: 900000 },
      // 32: jen cizí — to je normální dražba
      { drazba_id: 32, player_id: 3, nick: 'Cizi', castka: 400000 },
      // 33: cizí dražba, přihazuje hlavní — nic mu nevyčítáme
      { drazba_id: 33, player_id: 1, nick: 'Hlavni', castka: 700000 },
    ],
  };
  const n = A.drazbyNaoko(d, S);
  ma(n.length === 1 && n[0].id === 1, 'nález jen u prodávajícího s nastrčeným účtem',
    n.map((x) => x.id).join(','));
  ma(n[0].skoda === 900000, 'škoda je to, co v dražbě nechali ostatní', n[0].skoda);
  ma(/Pomocny/.test(n[0].dukazy[0].text), 'v důkazu je vidět, který účet přihazoval');

  // Bez cizích peněz není co vymáhat — přihazovat sám sobě do prázdna je hloupost, ne podvod.
  const samotar = A.drazbyNaoko({ drazby: [{ id: 41, prodavajici_id: 1, nazev: 'x' }],
    prihozy: [{ drazba_id: 41, player_id: 2, castka: 500000 }] }, S);
  ma(!samotar.length, 'bez cizích příhozů se nehlásí nic');
}

// ─── 3) Fond a akcie ────────────────────────────────────────────────────────
{
  console.log('\nProdej podílu do společného fondu');
  const d = {
    clenove: [
      { aliance_id: 7, player_id: 2 },     // ve fondu sedí pomocný účet
      { aliance_id: 7, player_id: 3 },
      { aliance_id: 8, player_id: 3 },
    ],
    equity: [
      // fond 7 koupil podíl ve firmě hlavního — a ve fondu je jeho vlastní účet
      { id: 51, fond_id: 7, firma_id: 1, podil: 0.3, cena: 20000000, stav: 'bezi' },
      // fond 8 koupil podíl u cizího — v pořádku
      { id: 52, fond_id: 8, firma_id: 1, podil: 0.2, cena: 9000000, stav: 'bezi' },
      // odkoupený podíl se nepočítá
      { id: 53, fond_id: 7, firma_id: 1, podil: 0.1, cena: 5000000, stav: 'odkoupeno' },
    ],
  };
  const n = A.fondAkcie(d, S);
  ma(n.length === 1 && n[0].id === 1, 'nález je u majitele firmy', n.map((x) => x.id).join(','));
  ma(n[0].skoda === 20000000, 'škoda je, co fond zaplatil', n[0].skoda);
  ma(n[0].dukazy.length === 1, 'a týká se jen toho jednoho podílu');
}

// ─── 4) Půjčky mezi vlastními účty ──────────────────────────────────────────
{
  console.log('\nPůjčky, co se nesplácejí');
  const d = { pujcky: [
    { id: 61, lender_id: 1, borrower_id: 2, borrower_nick: 'Pomocny', castka: 10000000,
      splatka: 1000000, splaceno: 0, stav: 'propadlo', zastava_spot: 'hk-1' },
    // Doplacená předčasně: splátkový kalendář nedoběhl, ale je vyrovnaná.
    { id: 62, lender_id: 1, borrower_id: 2, borrower_nick: 'Pomocny', castka: 5000000,
      splatka: 400000, splaceno: 10, stav: 'splaceno' },
    { id: 63, lender_id: 1, borrower_id: 3, borrower_nick: 'Cizi', castka: 8000000,
      splatka: 800000, splaceno: 0, stav: 'vymahano' },
    { id: 64, lender_id: 1, borrower_id: 2, borrower_nick: 'Pomocny', castka: 4000000,
      splatka: 400000, splaceno: 5, stav: 'bezi' },
  ] };
  const n = A.pujckyNaoko(d, S);
  ma(n.length === 1 && n[0].id === 1, 'nález u věřitele', n.map((x) => x.id).join(','));
  ma(n[0].skoda === 10000000 + 2000000, 'sčítá se nesplacený zbytek, splacená se nepočítá', n[0].skoda);
  ma(!JSON.stringify(n[0].dukazy).includes('Cizi'), 'půjčka cizímu hráči se nehlásí');
  ma(/zástav/.test(n[0].dukazy[0].text), 'u propadlé zástavy je to vidět');
}

// ─── Sloučení a vypínače ────────────────────────────────────────────────────
{
  console.log('\nCo z toho vyjde pro řízení');
  const d = {
    hraci: HRACI,
    obchody: [{ id: 71, from_id: 1, to_id: 2, smer: 'koupim', predmet: 'stroj', model: 'max', cena: 1 }],
    drazby: [{ id: 72, prodavajici_id: 1, nazev: 'x' }],
    prihozy: [{ drazba_id: 72, player_id: 2, castka: 1 }, { drazba_id: 72, player_id: 3, castka: 3000000 }],
    equity: [], clenove: [], pujcky: [],
  };
  const ven = A.vyhodnot(d, S, R);
  ma(ven.length === 1 && ven[0].id === 1, 'jeden řádek na hráče, ne jeden na nález');
  ma(ven[0].skoda === (CENA_MAX - 1) + 3000000, 'škody z detektorů se sčítají', ven[0].skoda);
  ma(ven[0].nalezy.length === 2, 'ale je vidět, z čeho se skládá', ven[0].nalezy.length);
  ma(ven[0].utvar === (CENA_MAX - 1 > 3000000 ? 'Celní správa' : 'Policie'),
    'případ vede útvar od největšího nálezu', ven[0].utvar);
  ma(ven[0].zmrazit === Math.round(ven[0].skoda * 1.2), 'zmrazení se počítá ze součtu');
  ma(ven[0].trest.nejvyssi === Math.round(ven[0].skoda * 1.3), 'i tresty');
  ma(ven[0].typ === 'agent', 'případ je označený jako od agenta');

  const vypnuto = A.vyhodnot(d, S, Object.assign({}, R, { det_spojene_obchody: false }));
  ma(vypnuto[0].skoda === 3000000, 'vypnutý detektor se nepočítá', vypnuto[0].skoda);
  const vseVypnuto = A.vyhodnot(d, S, Object.assign({}, R,
    { det_spojene_obchody: false, det_drazby: false, det_fond: false, det_pujcky: false }));
  ma(!vseVypnuto.length, 'se všemi vypnutými nenajde nic');

  // Zablokovaný účet už nestíháme — nemá co zmrazit a nemůže se bránit.
  const zabl = A.vyhodnot(Object.assign({}, d, {
    hraci: HRACI.map((h) => (h.id === 1 ? Object.assign({}, h, { disabled: true }) : h)) }), S, R);
  ma(!zabl.length, 'zablokovaný hráč se nestíhá');
  ma(!A.vyhodnot({ hraci: HRACI }, S, R).length, 'prázdná hra nic nenajde');
}

// ─── V kódu ─────────────────────────────────────────────────────────────────
{
  console.log('\nPojistky v kódu');
  const fs = require('fs');
  const RIZ = fs.readFileSync(path.join(__dirname, '..', 'services/game/zlocin-rizeni.js'), 'utf8');
  ma(/R\.agent_zapnuto/.test(RIZ), 'agent má vlastní vypínač');
  ma(/x\.skoda >= \(R\.agent_min_skoda \|\| 0\)/.test(RIZ), 'malé nálezy se nevedou');
  ma(/kandidati/.test(RIZ) && /n >= R\.max_novych_za_tik/.test(RIZ), 'pojistka na počet případů platí i pro agenta');
  const ZL = fs.readFileSync(path.join(__dirname, '..', 'services/game/zlocin.js'), 'utf8');
  ma(/agent_zapnuto: false/.test(ZL), 've výchozím stavu je agent vypnutý');
  const ADM = fs.readFileSync(path.join(__dirname, '..', 'routes/game-admin.routes.js'), 'utf8');
  ma(/\/zlocin\/agent/.test(ADM), 'nálezy se dají prohlédnout nanečisto');
}

console.log(chyb ? '\n' + chyb + ' CHYB' : '\nVšechno sedí.');
process.exit(chyb ? 1 : 0);
