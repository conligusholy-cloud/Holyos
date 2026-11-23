// Noviny o zločinu v jazyce čtenáře.
//
// Zpráva o kontrole leží v novinách dny a čte ji každý hráč, ne jen ten, komu
// se píše. Dokud se do tabulky ukládala hotová česká věta, viděl ji česky i
// hráč, co hraje italsky — a zpětně se s tím nedalo dělat nic, text v
// databázi už byl. Proto se ukládá kód a údaje a věta se skládá až u čtenáře.
//
// Hlídá se tu troje:
//  · že se zpráva s kódem opravdu skládá z katalogu, ne ze schované české věty
//  · že čísla dostane čtenář ve svém zvyku (1 234 567 × 1.234.567)
//  · že řízení kód do databáze doopravdy zapisuje — bez toho je zbytek k ničemu
const fs = require('fs');
const path = require('path');
const Module = require('module');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const koren = path.join(__dirname, '..');
const cti = (p) => fs.readFileSync(path.join(koren, p), 'utf8');

const TEXTY = require('../services/game/texty');
const ZT = require('../services/game/zlocin-texty');

// ─── Zpráva se skládá u čtenáře ──────────────────────────────────────────────
const obvineni = { typ: 'agent', kod: 'pujcky', drive: 0, nalezy: [{ kod: 'pujcky', skoda: 1234567,
  dukazy: [{ klic: 'pujcka', predmet: null, zastava: 'Praha 7', text: 'ČESKÁ ZÁLOHA',
    u: { p1: 1000000, p2: 'nastrc', p4: 900000, p5: 'vymahano' } }] }] };
const zprava = { text_kod: 'kontrola', emblem: '🚓',
  text_data: { firma: 'Pinon s.r.o.', utvar: 'Policie', skoda: 1234567, obvineni },
  nadpis: 'ULOŽENÝ ČESKÝ NADPIS', text: 'ULOŽENÝ ČESKÝ TEXT' };

const cs = ZT.vykresli(zprava, 'cs');
const it = ZT.vykresli(zprava, 'it');
ok('zpráva s kódem se skládá z katalogu, ne z uložené věty',
  cs.text.indexOf('ULOŽENÝ') < 0 && cs.nadpis.indexOf('ULOŽENÝ') < 0, '— ' + cs.nadpis);
ok('Ital dostane italsky', it.nadpis.indexOf('Verifica') === 0 || it.nadpis.indexOf('Verifica') > 0,
  '— ' + it.nadpis);
ok('a Čech česky', cs.nadpis.indexOf('Kontrola') > 0, '— ' + cs.nadpis);
ok('útvar se přeloží taky', it.text.indexOf('Polizia') >= 0 && cs.text.indexOf('Policie') >= 0);
ok('znak útvaru zůstane', it.nadpis.indexOf('🚓') === 0);

// Čísla se formátují podle zvyku čtenáře. Česká mezera v italské větě je
// drobnost, které si všimne každý Ital a nikdo z nás.
const mezery = (x) => String(x).replace(/[\u00a0\u202f\u2009]/g, ' ');
ok('čísla v českém zvyku', mezery(cs.text).indexOf('1 234 567') > 0, '— ' + cs.text);
ok('čísla v italském zvyku', it.text.indexOf('1.234.567') > 0, '— ' + it.text);

// Důkaz je uložený jako klíč a údaje — jinak by uvnitř italské zprávy svítila
// česká věta od agenta.
ok('důkaz se skládá taky',
  it.text.indexOf('ČESKÁ ZÁLOHA') < 0 && it.text.indexOf('garanzia') > 0, '— ' + it.text);
ok('a zástava se do něj dostane', cs.text.indexOf('Praha 7') > 0 && it.text.indexOf('Praha 7') > 0);

// Stav půjčky je v databázi strojový kód. Beze slovníku by Italovi v obvinění
// svítilo „vymahano" — vypadá to jako rozbitý překlad, a je to tabulka.
ok('stav půjčky se přeloží',
  cs.text.indexOf('po splatnosti') < 0 && it.text.indexOf('in riscossione') > 0, '— ' + it.text);
ok('a neznámý stav projde, jak je',
  ZT.dukaz({ klic: 'pujcka', u: { p1: 1, p2: 'x', p4: 2, p5: 'jiný' } }, 'cs').indexOf('jiný') > 0);

// Důkaz z doby před kódy: česká věta je jediné, co o něm víme.
ok('starý důkaz bez klíče se vypíše, jak je',
  ZT.dukaz({ text: 'stará česká věta' }, 'it') === 'stará česká věta');

// Řádek z doby před migrací kód nemá. Musí se vypsat, co je uložené — jinak
// by se z novin staly prázdné rámečky.
const stara = ZT.vykresli({ nadpis: 'Kontrola firmy X', text: 'Stará zpráva.' }, 'it');
ok('zpráva bez kódu se vypíše z databáze',
  stara.nadpis === 'Kontrola firmy X' && stara.text === 'Stará zpráva.');

// ─── Žádný klíč nesmí chybět v katalogu ──────────────────────────────────────
// Chybějící klíč projde kódem bez hlesnutí a hráč uvidí v novinách
// „zlocin.nalez.fond" místo věty.
const KAT = JSON.parse(cti('services/game/texty/cs.json'));
const zdrojZT = cti('services/game/zlocin-texty.js');
const chybi = [];
['kontrola', 'premer', 'soud', 'rozsudek', 'odvolani', 'uzavreno', 'zruseno'].forEach((k) => {
  ['nadpis', 'text'].forEach((c) => {
    if (!KAT['zlocin.zprava.' + k + '.' + c]) chybi.push('zlocin.zprava.' + k + '.' + c);
  });
});
['spojene_obchody', 'drazby', 'fond', 'pujcky'].forEach((k) => {
  if (!KAT['zlocin.nalez.' + k]) chybi.push('zlocin.nalez.' + k);
  if (!KAT['zlocin.podezreni.' + k]) chybi.push('zlocin.podezreni.' + k);
});
['levne', 'drahe', 'drazba', 'fond', 'pujcka'].forEach((k) => {
  if (!KAT['zlocin.dukaz.' + k]) chybi.push('zlocin.dukaz.' + k);
});
Object.keys(ZT.UTVAR).forEach((n) => { if (!KAT[ZT.UTVAR[n]]) chybi.push(ZT.UTVAR[n]); });
['zlocin.uz_odsouzeno', 'zlocin.podezreni.kupec', 'zlocin.podezreni.zvouci', 'zlocin.podezreni.jine',
  'zlocin.skutek.nalez', 'zlocin.skutek.nalez_dukazy', 'zlocin.skutek.provize', 'zlocin.skutek.sleva',
  'zlocin.skutek.kdo', 'zlocin.skutek.a_dalsi', 'zlocin.predmet.stroj', 'zlocin.predmet.pradlomat',
  'zlocin.dukaz.pujcka_zastava', 'zlocin.pozn.nikdo', 'zlocin.pozn.nerozhodne',
  'zlocin.zprava.uzavreno.propadlo', 'zlocin.zprava.uzavreno.nedoplatek',
  'zlocin.stav_pujcky.bezi', 'zlocin.stav_pujcky.splaceno', 'zlocin.stav_pujcky.propadlo',
  'zlocin.stav_pujcky.vymahano'].forEach((k) => {
  if (!KAT[k]) chybi.push(k);
});
ok('každý klíč z vykreslování je v katalogu', !chybi.length, chybi.join(', '));
// Jediná čeština, která tu smí být napevno, jsou jména útvarů — ta leží
// stejně napsaná v databázi a v administraci se na ně sahá.
ok('věty se skládají z katalogu, ne v kódu',
  !/nadpis:\s*['"][^'"]{12,}/.test(zdrojZT) && /TEXTY\.t\(/.test(zdrojZT));

// ─── Rozhraní novin a chyby jdou přes katalog ────────────────────────────────
const zdrojR = cti('routes/game-zlocin.routes.js');
ok('rámeček novin se skládá z katalogu', /zlocin\.ui\./.test(zdrojR) && zdrojR.indexOf("'Prádelní noviny'") < 0);
ok('zprávy se vykreslují u čtenáře', /ZT\.vykresli\(z, jazyk\)/.test(zdrojR));
ok('chyby hlasování se překládají', /TEXTY\.t\(r\.klic|chyba\(r,/.test(zdrojR));

const uiChybi = ['noviny', 'precteno', 'hlasovani', 'hlasuj', 'bezi', 'zadne', 'trest', 'skoda', 'moje',
  'odvolat', 'odeslat', 'odvolani_ph', 'hlasoval', 'konci', 'zavrit', 'hlasy', 'hlasu', 'odvolani_podano',
  'stav_kontrola', 'stav_soud', 'stav_odvolani', 'stav_uzavreno', 'stav_zruseno',
  'uroven_nejnizsi', 'uroven_stredni', 'uroven_nejvyssi'].filter((k) => !KAT['zlocin.ui.' + k]);
ok('rozhraní novin má všechny texty', !uiChybi.length, uiChybi.join(', '));
const errChybi = ['pripad_nenalezen', 'hlasovani_skoncilo', 'volba', 'nemuzes_hlasovat', 'odvolat_nelze',
  'odvolani_kratke', 'duvod_obvineny', 'duvod_mlady_ucet'].filter((k) => !KAT['zlocin.err.' + k]);
ok('a chybové hlášky taky', !errChybi.length, errChybi.join(', '));

// ─── Řízení kód doopravdy ukládá ─────────────────────────────────────────────
// Tohle je to místo, kde se to dá tiše rozbít: stačí napsat zprávu bez kódu
// a v novinách zůstane česká věta navždy.
let ZPRAVY = [], DORUCENKY = [], PRIPAD = null;
const puvodni = Module.prototype.require;
Module.prototype.require = function (co) {
  if (/config\/database$/.test(co)) {
    return { prisma: {
      // Případ se po zápisu vrací celý — jméno firmy se do zprávy bere z něj.
      gameZlocin: { update: async (x) => Object.assign({}, PRIPAD, x.data) },
      gamePlayer: { findUnique: async () => ({ state: { cash: 0 } }) },
      gameDelivery: { create: async (x) => { DORUCENKY.push(x.data); return x.data; } },
      gameZlocinZprava: { create: async (x) => { ZPRAVY.push(x.data); return x.data; } },
    } };
  }
  return puvodni.apply(this, arguments);
};
const RIZ = require('../services/game/zlocin-rizeni');
const prisma = require('../config/database').prisma;

(async () => {
  const R = { koef_zabaveni: 0.4, trest_nejnizsi: 1, trest_stredni: 1.2, trest_nejvyssi: 1.3 };
  PRIPAD = { id: 1, hlavni_id: 2, stav: 'soud', skoda: 1000000, zmrazeno: 0,
    emblem: '⚖️', firma: 'Pinon s.r.o.', hlavni_nick: 'pinon', detail: {} };
  await RIZ.premer(prisma, R, PRIPAD, { id: 2, skoda: 5000000 });
  ok('řízení zapisuje zprávu s kódem', ZPRAVY.length === 1 && ZPRAVY[0].text_kod === 'premer',
    '— ' + JSON.stringify(ZPRAVY[0] && ZPRAVY[0].text_kod));
  ok('a s údaji, ze kterých se věta složí',
    ZPRAVY[0] && ZPRAVY[0].text_data && ZPRAVY[0].text_data.nova === 5000000,
    '— ' + JSON.stringify(ZPRAVY[0] && ZPRAVY[0].text_data));
  ok('česká věta zůstává jako záloha', !!(ZPRAVY[0] && ZPRAVY[0].text && ZPRAVY[0].nadpis));
  const u = ZT.vykresli(ZPRAVY[0], 'it');
  ok('a uložená zpráva jde přečíst italsky',
    u.text.indexOf('5.000.000') > 0 && u.text.indexOf('Pinon') > 0, '— ' + u.text);

  // Schéma musí ty sloupce mít — bez nich zápis spadne až v provozu.
  const schema = cti('prisma/schema.prisma');
  const model = schema.slice(schema.indexOf('model GameZlocinZprava'));
  ok('tabulka zpráv má sloupce na kód a údaje',
    /text_kod/.test(model.slice(0, 700)) && /text_data/.test(model.slice(0, 700)));

  console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
  process.exit(chyb ? 1 : 0);
})();
