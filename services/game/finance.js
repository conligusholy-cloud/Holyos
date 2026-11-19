// =============================================================================
// Laundromat Tycoon — půjčky mezi hráči a podíly ve firmách
// =============================================================================
// Co si hráči domluví na burze, odsud se to pak každý herní měsíc vypořádá:
// splátka půjčky jde od dlužníka věřiteli, podíl vyplácí firma investorovi —
// a když firma prodělává, doplácí investor své procento zpátky.
//
// Peníze se mezi hráči posílají doručenkami (GameDelivery). Hra žije v
// prohlížeči, takže jí jen řekneme, co si má připsat nebo odepsat.
//
// Když dlužník na splátku nemá, počítá se mu zmeškaná. Zastavený prádlomat
// propadá hned při první — zástava má mít zuby, jinak je to jen ozdoba.
// Kdo žádnou nedal, má tři pokusy a pak mu zbytek dluhu spadne do banky —
// odtud už hru dovede ke krachu její vlastní mechanika.

'use strict';

const { prisma } = require('../../config/database');
const DIVIDENDA = require('./dividenda');
const AUDIT = require('./audit');

const MESIC_MS = 43200000;          // herní měsíc = 12 skutečných hodin
const ZMESKAT_BEZ_ZASTAVY = 3;      // kolik odpuštěných splátek má dlužník bez zástavy
const ZMESKAT_SE_ZASTAVOU = 1;      // se zástavou propadá hned při první nezaplacené
// Se zástavou — prádlomatem i podílem — propadá hned při první nezaplacené
// splátce. Bez krytí má dlužník tři pokusy.
const zmeskatMax = (p) => ((p.zastava_spot || p.zastava_podil) ? ZMESKAT_SE_ZASTAVOU : ZMESKAT_BEZ_ZASTAVY);
const TIK_MS = 5 * 60000;           // jak často se kouká, co je splatné

const stavu = (p) => (p && p.state) || {};

// Co firmě měsíčně zbyde. Počítá se ze stavu hry, který klient ukládá —
// stejné číslo, jaké hráč vidí v hlavičce.
function zbydeMesicne(st) {
  try {
    const acct = require('../../routes/game-account.routes');
    if (typeof acct._zbydeMesicne === 'function') return Math.round(acct._zbydeMesicne(st) || 0);
  } catch (e) { /* spočítáme níž */ }
  return 0;
}

async function dorucit(tx, player_id, kind, amount, popis, extra) {
  await tx.gameDelivery.create({ data: Object.assign({ player_id, kind, amount, popis }, extra || {}) });
}

// ─── Splátky půjček ──────────────────────────────────────────────────────────
async function splatkyPujcek(ted) {
  const due = await prisma.gameLoan.findMany({
    where: { stav: 'bezi', dalsi_at: { lte: ted } }, orderBy: { dalsi_at: 'asc' }, take: 200,
  });
  for (const p of due) {
    try {
      const dluznik = await prisma.gamePlayer.findUnique({ where: { id: p.borrower_id } });
      const veritel = await prisma.gamePlayer.findUnique({ where: { id: p.lender_id } });
      if (!dluznik || !veritel) {
        await prisma.gameLoan.update({ where: { id: p.id },
          data: { stav: 'splaceno', dalsi_at: new Date(ted.getTime() + MESIC_MS) } });
        continue;
      }
      // Řízení o zločinu: část hotovosti je zmrazená. Dluhy se platí dál —
      // chybějící část splátky se bere ze zmrazené částky (uvolní se a hned
      // odejde věřiteli), o stejnou sumu se pak sníží to, co soud zadržuje.
      const rizeni = await prisma.gameZlocin.findFirst({
        where: { hlavni_id: p.borrower_id, stav: { in: ['kontrola', 'soud', 'odvolani'] }, zmrazeno: { gt: 0 } },
      });
      const hotovostVolna = Math.round(stavu(dluznik).cash || 0);
      let zeZmrazeneho = 0;
      if (rizeni && hotovostVolna < p.splatka) {
        zeZmrazeneho = Math.min(rizeni.zmrazeno, p.splatka - Math.max(0, hotovostVolna));
      }
      const hotovost = hotovostVolna + zeZmrazeneho;
      const zbyvaSplatek = Math.max(0, p.mesicu - p.splaceno);
      if (!zbyvaSplatek) {
        await prisma.gameLoan.update({ where: { id: p.id }, data: { stav: 'splaceno' } });
        continue;
      }
      if (hotovost >= p.splatka) {
        await prisma.$transaction(async (tx) => {
          if (zeZmrazeneho > 0) {
            await tx.gameZlocin.update({ where: { id: rizeni.id }, data: { zmrazeno: rizeni.zmrazeno - zeZmrazeneho } });
            await dorucit(tx, p.borrower_id, 'cash', zeZmrazeneho,
              'Uvolněno ze zmrazené částky na splátku půjčky', {});
          }
          await dorucit(tx, p.borrower_id, 'cash', -p.splatka,
            'Splátka půjčky — ' + p.lender_nick,
            { text_kod: 'dor.splatka_pujcky', text_data: { p1: p.lender_nick } });
          await dorucit(tx, p.lender_id, 'cash', p.splatka,
            'Splátka od ' + p.borrower_nick,
            { text_kod: 'dor.splatka_od', text_data: { p1: p.borrower_nick } });
          const hotovo = p.splaceno + 1 >= p.mesicu;
          await tx.gameLoan.update({ where: { id: p.id }, data: {
            splaceno: p.splaceno + 1, zmeskano: 0,
            stav: hotovo ? 'splaceno' : 'bezi',
            dalsi_at: new Date(ted.getTime() + MESIC_MS),
          } });
        });
        continue;
      }
      // Nemá. Zmeškaná splátka — a po tolikáté se vymáhá.
      const zmeskano = p.zmeskano + 1;
      const max = zmeskatMax(p);
      if (zmeskano < max) {
        await prisma.gameLoan.update({ where: { id: p.id }, data: {
          zmeskano, dalsi_at: new Date(ted.getTime() + MESIC_MS),
        } });
        await prisma.gameDelivery.createMany({ data: [
          { player_id: p.borrower_id, kind: 'zprava',
            popis: 'Nezaplatil jsi splátku ' + p.lender_nick + '. Zmeškané: ' + zmeskano + ' ze ' + max + '.' , text_kod: 'dor.nezaplatil_jsi_splatku_zmeskane_ze', text_data: { p1: p.lender_nick, p2: zmeskano, p3: max }},
          { player_id: p.lender_id, kind: 'zprava',
            popis: p.borrower_nick + ' nezaplatil splátku (' + zmeskano + ' ze ' + max + ').' , text_kod: 'dor.nezaplatil_splatku_ze', text_data: { p1: p.borrower_nick, p2: zmeskano, p3: max }},
        ] });
        continue;
      }
      const zbyva = Math.max(0, p.splatka * zbyvaSplatek);
      // Konverze: pohledávka se mění na NOVĚ VYDANÝ podíl. Na rozdíl od
      // zastaveného podílu se nebere z toho, co je ve firmě volné — vydá se
      // nový a všichni dosavadní podílníci se o stejný poměr zředí, přesně
      // jako u kapitálového vstupu. Dluh tím končí: věřitel vyměnil
      // pohledávku za kus firmy a víc mu nikdo nic nedluží.
      if (p.konverze_podil) {
        const PODILY = require('./podily');
        const f = Math.max(0, Math.min(1, Number(p.konverze_podil) || 0));
        await prisma.$transaction(async (tx) => {
          const auditPred = await AUDIT.otisk(tx, p.borrower_id);
          const stavajici = await tx.gameEquity.findMany({
            where: { firma_id: p.borrower_id, stav: 'bezi' },
            select: { id: true, podil: true, investor_id: true },
          });
          for (const e of PODILY.redeni(stavajici, f)) {
            await tx.gameEquity.update({ where: { id: e.id }, data: { podil: e.podil } });
          }
          await tx.gameEquity.create({ data: {
            investor_id: p.lender_id, investor_nick: p.lender_nick,
            firma_id: p.borrower_id, firma_nick: p.borrower_nick,
            podil: f, cena: Math.round(zbyva), vyplaceno: 0,
            dalsi_at: new Date(ted.getTime() + MESIC_MS),
          } });
          await dorucit(tx, p.borrower_id, 'zprava', null,
            'Nezaplatil jsi splátku a půjčka se změnila na podíl',
            { text_kod: 'dor.konverze_tobe',
              text_data: { p1: Math.round(f * 100), p2: p.lender_nick } });
          await dorucit(tx, p.lender_id, 'zprava', null,
            'Půjčka ' + p.borrower_nick + ' se změnila na podíl',
            { text_kod: 'dor.konverze_tvoje',
              text_data: { p1: Math.round(f * 100), p2: p.borrower_nick } });
          // Zředili se i ostatní podílníci a nikdo se jich neptal.
          const komu = stavajici.filter((e) => e.investor_id !== p.lender_id);
          for (const e of komu) {
            await dorucit(tx, e.investor_id, 'zprava', null,
              'Ve firmě ' + p.borrower_nick + ' se tvůj podíl zředil',
              { text_kod: 'dor.redeni_podilu',
                text_data: { p1: p.borrower_nick, p2: Math.round(f * 100) } });
          }
          await tx.gameLoan.update({ where: { id: p.id }, data: { stav: 'propadlo', zmeskano } });
          await AUDIT.zapis(tx, p.borrower_id, auditPred,
            { duvod: 'konverze', protistrana_id: p.lender_id });
        });
        console.log('[game-finance] půjčka ' + p.id + ' se změnila na podíl '
          + Math.round(f * 100) + ' % pro ' + p.lender_nick);
        continue;
      }
      if (p.zastava_podil) {
        // Zastavený podíl přechází věřiteli. Od té chvíle je to jeho běžný
        // podíl — může ho držet, prodat dál, nabídnout k odkupu i vydražit.
        // Cenou je nesplacený zbytek: tolik ho ten podíl opravdu stál.
        const firma = await prisma.gamePlayer.findUnique({ where: { id: p.borrower_id } });
        const veritel = await prisma.gamePlayer.findUnique({ where: { id: p.lender_id } });
        if (firma && veritel) {
          await prisma.$transaction(async (tx) => {
            const auditPred = await AUDIT.otisk(tx, p.borrower_id);
            await tx.gameEquity.create({ data: {
              investor_id: p.lender_id, investor_nick: p.lender_nick,
              firma_id: p.borrower_id, firma_nick: p.borrower_nick,
              podil: p.zastava_podil, cena: Math.round(zbyva), vyplaceno: 0,
              dalsi_at: new Date(ted.getTime() + MESIC_MS),
            } });
            await dorucit(tx, p.borrower_id, 'zprava', null,
              'Nezaplatil jsi splátku a propadl zastavený podíl',
              { text_kod: 'dor.propadl_podil_tobe',
                text_data: { p1: Math.round(p.zastava_podil * 100), p2: p.lender_nick } });
            await dorucit(tx, p.lender_id, 'zprava', null,
              'Propadlý podíl od ' + p.borrower_nick,
              { text_kod: 'dor.propadl_podil_tvuj',
                text_data: { p1: Math.round(p.zastava_podil * 100), p2: p.borrower_nick } });
            await tx.gameLoan.update({ where: { id: p.id }, data: { stav: 'propadlo', zmeskano } });
            await AUDIT.zapis(tx, p.borrower_id, auditPred,
              { duvod: 'zastava', protistrana_id: p.lender_id });
          });
          console.log('[game-finance] podíl ' + Math.round(p.zastava_podil * 100)
            + ' % propadl ' + p.lender_nick);
          continue;
        }
      }
      if (p.zastava_spot) {
        // Zástava propadá věřiteli i s místem.
        const c = await prisma.gameSpotClaim.findUnique({ where: { spot_id: p.zastava_spot } });
        if (c && c.player_id === p.borrower_id) {
          await prisma.$transaction(async (tx) => {
            await tx.gameSpotClaim.update({ where: { spot_id: p.zastava_spot },
              data: { player_id: p.lender_id, nick: p.lender_nick } });
            await dorucit(tx, p.borrower_id, 'unit_remove', null,
              'Nezaplatil jsi splátku a propadla zástava — ' + (c.name || p.zastava_spot)
              + ' si vzal ' + p.lender_nick,
              { spot_id: p.zastava_spot, text_kod: 'dor.propadla_zastava_tobe',
                text_data: { p1: (c.name || p.zastava_spot), p2: p.lender_nick } });
            await dorucit(tx, p.lender_id, 'unit_add', null,
              'Propadlá zástava od ' + p.borrower_nick + ' — ' + (c.name || '') + ' je tvůj',
              { text_kod: 'dor.propadla_zastava_tvoje',
                text_data: { p1: p.borrower_nick, p2: (c.name || '') },
                spot_id: p.zastava_spot, model: c.model,
                data: { name: c.name, lat: c.lat, lon: c.lon, rent: c.rent, area_key: c.area_key } });
            await tx.gameLoan.update({ where: { id: p.id }, data: { stav: 'propadlo', zmeskano } });
          });
          console.log('[game-finance] zástava ' + p.zastava_spot + ' propadla ' + p.lender_nick);
          continue;
        }
      }
      // Zástava není (nebo už dlužníkovi nepatří) — zbytek dluhu jde do banky.
      await prisma.$transaction(async (tx) => {
        await dorucit(tx, p.borrower_id, 'cash', -zbyva,
          'Vymáhaná půjčka — ' + p.lender_nick,
          { text_kod: 'dor.vymahana_pujcka', text_data: { p1: p.lender_nick } });
        await dorucit(tx, p.lender_id, 'cash', zbyva,
          'Doplacená půjčka od ' + p.borrower_nick,
          { text_kod: 'dor.doplacena_pujcka', text_data: { p1: p.borrower_nick } });
        await tx.gameLoan.update({ where: { id: p.id }, data: { stav: 'vymahano', zmeskano } });
      });
      console.log('[game-finance] půjčka #' + p.id + ' vymáhána po ' + zmeskano + ' zmeškaných');
    } catch (e) {
      console.warn('[game-finance] půjčka #' + p.id + ':', e.message);
    }
  }
}

// ─── Výplata podílů ──────────────────────────────────────────────────────────
async function vyplatyPodilu(ted) {
  const due = await prisma.gameEquity.findMany({
    where: { stav: 'bezi', dalsi_at: { lte: ted } }, orderBy: { dalsi_at: 'asc' }, take: 200,
  });
  for (const e of due) {
    try {
      const firma = await prisma.gamePlayer.findUnique({ where: { id: e.firma_id } });
      const investor = await prisma.gamePlayer.findUnique({ where: { id: e.investor_id } });
      if (!firma || !investor) {
        await prisma.gameEquity.update({ where: { id: e.id }, data: { stav: 'odkoupeno' } });
        continue;
      }
      const zbyde = zbydeMesicne(stavu(firma));
      // Dividendová politika krátí jen zisk. Ztrátu nese podílník vždycky
      // celou — jinak by si většinový nastavil před ztrátovým měsícem nulu
      // a doplatek nechal na majiteli.
      // Minimální dividenda: co firma nevydělá, se nikomu nebere — rozdíl
      // zůstane zapsaný jako nedoplatek a vyplatí se, až firma vydělá.
      const r = DIVIDENDA.rozpad(zbyde, e.podil, firma.dividenda_pct,
        firma.dividenda_min, e.nedoplatek);
      const castka = r.vyplata;
      const dalsi = new Date(ted.getTime() + MESIC_MS);
      if (!castka) {
        await prisma.gameEquity.update({ where: { id: e.id },
          data: { dalsi_at: dalsi, nedoplatek: r.nedoplatek } });
        continue;
      }
      const pct = Math.round(e.podil * 100) + ' %';
      // Podíl může držet fond aliance. Fond nemá doručenky — peníze mu
      // chodí rovnou do jeho pokladny, odkud si je členové rozdělují.
      // Doplatek ze ztráty se mu strhává stejnou cestou.
      if (e.fond_id != null) {
        await prisma.$transaction(async (tx) => {
          await tx.gameAliance.update({ where: { id: e.fond_id },
            data: { pokladna: { increment: castka } } });
          await tx.gameDelivery.create({ data: {
            player_id: e.firma_id, kind: 'cash', amount: -castka,
            popis: 'Výplata podílu — fond aliance',
            text_kod: 'dor.vyplata_podilu', text_data: { p1: 'fond' } } });
          await tx.gameEquity.update({ where: { id: e.id },
            data: { vyplaceno: e.vyplaceno + castka, dalsi_at: dalsi,
              nedoplatek: r.nedoplatek } });
        });
        continue;
      }
      await prisma.$transaction(async (tx) => {
        if (castka > 0) {
          await dorucit(tx, e.investor_id, 'cash', castka, 'Podíl ' + pct + ' ve firmě ' + e.firma_nick,
            { text_kod: 'dor.podil_ve_firme', text_data: { p1: pct, p2: e.firma_nick } });
          await dorucit(tx, e.firma_id, 'cash', -castka, 'Výplata podílu — ' + e.investor_nick,
            { text_kod: 'dor.vyplata_podilu', text_data: { p1: e.investor_nick } });
        } else {
          // Firma prodělává: investor nese svůj díl ztráty.
          await dorucit(tx, e.investor_id, 'cash', castka, 'Podíl na ztrátě firmy ' + e.firma_nick,
            { text_kod: 'dor.podil_na_ztrate', text_data: { p1: e.firma_nick } });
          await dorucit(tx, e.firma_id, 'cash', -castka, 'Doplatek od podílníka ' + e.investor_nick,
            { text_kod: 'dor.doplatek_od_podilnika', text_data: { p1: e.investor_nick } });
        }
        await tx.gameEquity.update({ where: { id: e.id },
          data: { vyplaceno: e.vyplaceno + castka, dalsi_at: dalsi,
            nedoplatek: r.nedoplatek } });
      });
    } catch (err) {
      console.warn('[game-finance] podíl #' + e.id + ':', err.message);
    }
  }
}

let bezi = false;
async function tik() {
  if (bezi) return;
  bezi = true;
  try {
    const ted = new Date();
    await splatkyPujcek(ted);
    await vyplatyPodilu(ted);
    // Podíl ve firmě, kterou už nikdo nehraje, by se jinak vyplácel donekonečna
    // a vyplácel nulu. Uzavře se a investorovi se vrátí, co z firmy zbylo.
    await require('./konec').uklidMrtvePodily();
    // Hodnota fondu se nikam jinam neukládá — bez vzorků by graf neměl
    // z čeho vzniknout. Zapisuje se nejvýš jednou za hodinu, tik běží po
    // pěti minutách, takže se tu většinou jen podívá a odeše.
    // Vlastní záchyt schválně: graf je přídavek, nesmí se tvářit jako
    // selhaný těp. Dokud nedoběhne migrace, tahle tabulka ještě není.
    try {
      const H = require('./fond-historie');
      await H.vzorkuj(ted);
      await H.uklid(ted);
    } catch (e) { console.warn('[game-finance] vzorek fondu:', e && e.message); }
  } catch (e) {
    console.warn('[game-finance] tik:', e && e.message);
  } finally { bezi = false; }
}

function start() {
  setTimeout(tik, 20000);          // po startu chvíli počkáme, ať naběhne zbytek
  setInterval(tik, TIK_MS);
  console.log('[game-finance] hlídání splátek a podílů běží');
}

module.exports = { start, tik, anuitaMesicu: MESIC_MS };
