// =============================================================================
// Laundromat Tycoon — stínová pokladna
// =============================================================================
// Hotovost, jak ji vede server sám. Zatím NEROZHODUJE: hra běží dál na svém
// čísle a tohle stojí vedle něj. Teprve až se obě čísla přestanou rozcházet,
// může se autorita přepnout sem — to je podmínka, na které visí rezervace
// peněz, minimální dividenda i fond aliance.
//
// Proti čekané změně je rozdíl v jediném, ale podstatném: čekaná změna
// porovnává skok mezi dvěma uloženími, takže se chyba o korunu za uložení
// ztratí v šumu. Pokladna ty kroky SČÍTÁ, takže se taková chyba po dni hraní
// projeví jako viditelný rozdíl.
//
// Když se čísla rozejdou, pokladna si drží svoje. Nesrovnává se sama — to by
// zahodilo přesně to, kvůli čemu tu je. Srovnat jde ručně v administraci, až
// se příčina rozdílu najde a opraví.
'use strict';

const { prisma } = require('../../config/database');

const hotovosti = (st) => Math.round(Number((st || {}).cash) || 0);
const kolik = (x) => (x && typeof x === 'object' ? Object.keys(x).length : 0);

// Z čeho se počítá příští posun. Ukládá se jen to, co do výpočtu opravdu
// vstupuje — celý stav hry by byl v každém řádku zbytečně a je velký.
// U měst a obhlídek stačí počty, u strojů jen ty s rozjetou poruchou:
// u ostatních není co poznat.
function otiskStavu(st) {
  const s = st || {};
  const units = Array.isArray(s.units) ? s.units : [];
  return {
    cash: hotovosti(s),
    loan: Math.round(Number(s.loan) || 0),
    areas: kolik(s.areas),
    revealed: kolik(s.revealed),
    pobocky: Array.isArray(s.pobocky) ? s.pobocky.length : 0,
    sidlo: (s.sidlo && s.sidlo.areaId) ? { areaId: s.sidlo.areaId } : null,
    ceta: (s.ceta && s.ceta.od)
      ? { od: s.ceta.od, shanec: !!s.ceta.shanec, phm: Number(s.ceta.phm) || 0 } : null,
    denni: s.denni ? { den: Number(s.denni.den) || 0, kdy: String(s.denni.kdy || '') } : null,
    pojisteni: !!s.pojisteni,
    // Úvěry kvůli poplatku za změnu splatnosti: ten se pozná z počítadla
    // přepsání a počítá se z nesplacené jistiny před změnou.
    loans: (Array.isArray(s.loans) ? s.loans : []).map((l) => ({
      id: l && l.id, zbyva: Math.round(Number((l || {}).zbyva) || 0),
      prepsano: Number((l || {}).prepsano) || 0,
    })),
    // Stroje s rozjetou poruchou nebo katastrofou. U ostatních není co
    // poznat: zaplacená oprava i nově naskočená porucha se poznají jen tím,
    // že se proti minulému kroku změnily.
    units: units.filter((u) => u && (u.katastrofa || u.porucha)).map((u) => ({
      spotId: u.spotId || u.id,
      eco: { model: ((u.eco || {}).model) || 'mini' },
      katastrofa: u.katastrofa ? {
        platim: Math.round(Number(u.katastrofa.platim) || 0),
        hotovo: u.katastrofa.hotovo || null,
      } : null,
      porucha: u.porucha ? { od: Number(u.porucha.od) || 0 } : null,
    })),
  };
}

// Posun o jeden krok. Volá se od otisku, tedy nanejvýš jednou za deset minut
// na hráče — proto se počítá od posledního posunu pokladny, ne od minulého
// uložení: jinak by se vynechané intervaly ztratily.
async function posun(p, st, zisk, vyzvednuto) {
  const STROP = require('./strop');
  const ted = new Date();
  const row = await prisma.gamePokladna.findUnique({ where: { player_id: p.id } });
  if (!row) {
    // Založení: číslu hry se jednou uvěří, protože historie neexistuje.
    // Od téhle chvíle si pokladna jede po svém.
    const nova = await prisma.gamePokladna.create({ data: {
      player_id: p.id, hotovost: hotovosti(st), hra: hotovosti(st),
      stav: otiskStavu(st), kroku: 0, at: ted,
    } });
    return { zalozeno: true, hotovost: nova.hotovost, hra: nova.hra, rozdil: 0 };
  }
  const od = Math.max(0, ted.getTime() - new Date(row.at).getTime());
  const cek = await STROP.ocekavanaZmena(p, st, od, zisk, vyzvednuto, row.stav);
  const hotovost = row.hotovost + (cek ? cek.celkem : 0);
  const hra = hotovosti(st);
  await prisma.gamePokladna.update({ where: { player_id: p.id }, data: {
    hotovost, hra, stav: otiskStavu(st), kroku: row.kroku + 1, at: ted,
  } });
  return { hotovost, hra, rozdil: hotovost - hra, od, kroku: row.kroku + 1, cek };
}

// Ruční srovnání. Dělá se, až se příčina rozdílu najde a opraví — do té doby
// se rozdíl má sčítat. Kolik se celkem srovnalo, zůstává v řádku: pokladna,
// která se srovnávala každý den, není hotová, i když dnes sedí.
async function srovnej(playerId) {
  const id = parseInt(playerId, 10);
  const row = await prisma.gamePokladna.findUnique({ where: { player_id: id } });
  if (!row) return { ok: false, error: 'Tenhle hráč pokladnu nemá.' };
  const o = row.hra - row.hotovost;
  await prisma.gamePokladna.update({ where: { player_id: id }, data: {
    hotovost: row.hra, srovnano_at: new Date(), srovnano_o: row.srovnano_o + o,
  } });
  return { ok: true, o, hotovost: row.hra };
}

// Přehled pro administraci: kdo se rozchází nejvíc.
async function prehled(limit) {
  const rows = await prisma.gamePokladna.findMany({ take: 5000 }).catch(() => []);
  const s = rows.map((r) => Object.assign({}, r, { rozdil: r.hotovost - r.hra }));
  s.sort((a, b) => Math.abs(b.rozdil) - Math.abs(a.rozdil));
  return { pocet: rows.length, radky: s.slice(0, limit || 20),
    sedi: s.filter((r) => Math.abs(r.rozdil) <= 1000).length,
    srovnavanych: s.filter((r) => r.srovnano_at).length };
}

module.exports = { otiskStavu, posun, srovnej, prehled };
