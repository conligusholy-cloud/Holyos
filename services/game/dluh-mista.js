// =============================================================================
// Laundromat Tycoon — co na prádlomatu vázne
// =============================================================================
// Kdo kupuje postavený prádlomat, má dostat prádlomat, ne cizí splátky.
// Dřív se claim jen přepsal na kupujícího a dluh zůstal viset — prodávající
// splácel stroj, který už nemá, a zastavený prádlomat se prodejem zbavil
// zástavy, takže věřitel přišel o krytí.
//
// Dluhy jsou dva a každý je jinde:
//  · bankovní úvěr na místo (stroj i přípojky) žije ve stavu hry: S.loans
//    se spotId. Server ho vidí v uloženém stavu hráče, tedy tak, jak ho hra
//    naposled uložila. Může být o kousek starší než pravda — proto se při
//    doplacení posílá hře pokyn „splať, co na tomhle místě máš", ne příkaz
//    na přesnou částku.
//  · půjčka od jiného hráče, která má prádlomat v zástavě (GameLoan se
//    zastava_spot). Tu zná server přesně a umí ji rovnou uzavřít.

'use strict';

// Kolik stojí doplatit půjčku hned. Současná hodnota zbývajících splátek:
// dlužník vrátí jistinu, úrok platí jen za dobu, kterou peníze měl.
function doplatek(p) {
  const zbyva = Math.max(0, (p.mesicu || 0) - (p.splaceno || 0));
  if (!zbyva) return 0;
  const r = (Number(p.urok) || 0) / 12;
  if (r <= 0) return Math.round((Number(p.splatka) || 0) * zbyva);
  return Math.round((Number(p.splatka) || 0) * (1 - Math.pow(1 + r, -zbyva)) / r);
}

// Bankovní úvěry vázané na jedno místo. Na jednom místě můžou být dva —
// na stroj a na přípojky — a sčítají se.
function banka(st, spotId) {
  if (!spotId) return 0;
  const uvery = Array.isArray(st && st.loans) ? st.loans : [];
  return Math.max(0, Math.round(uvery.reduce((a, l) => {
    if (!l || l.spotId !== spotId) return a;
    const zbyva = Number(l.zbyva) || 0;
    return zbyva > 0 ? a + zbyva : a;
  }, 0)));
}

// Co na místě vázne hráči, který ho vlastní.
async function naMiste(prisma, hrac, spotId) {
  const prazdno = { banka: 0, zastava: 0, pujcky: [], celkem: 0 };
  if (!hrac || !spotId) return prazdno;
  const pujcky = (await prisma.gameLoan.findMany({
    where: { zastava_spot: spotId, stav: 'bezi', borrower_id: hrac.id },
    orderBy: { id: 'asc' },
  })).map((p) => ({ id: p.id, lender_id: p.lender_id, lender_nick: p.lender_nick,
    mesicu: p.mesicu, splaceno: p.splaceno, castka: doplatek(p) }))
    .filter((p) => p.castka > 0);
  const b = banka((hrac && hrac.state) || {}, spotId);
  const z = pujcky.reduce((a, p) => a + p.castka, 0);
  return { banka: b, zastava: z, pujcky, celkem: b + z };
}

// Jak se cena rozdělí. Zástava má přednost před bankou: ta na tomhle stroji
// doopravdy visí, kdežto bankovní úvěr je jen závazek prodávajícího.
// Co cena nepokryje, zůstává dluhem prodávajícího — prodej se kvůli tomu
// nezastavuje, jen se z něj nestane způsob, jak dluh ututlat.
//
// Půjčka od hráče se doplácí celá, nebo vůbec: splátkový kalendář se nedá
// doplatit z půlky, aniž by se přepsaly splátky i úrok. Bankovní úvěr
// mimořádnou splátku unese, tam se pošle, co zbyde.
function rozdel(cena, dluh) {
  let zbyva = Math.max(0, Math.round(Number(cena) || 0));
  const pujcky = [];
  for (const p of (dluh && dluh.pujcky) || []) {
    if (p.castka > 0 && zbyva >= p.castka) {
      pujcky.push(Object.assign({}, p, { zaplatit: p.castka }));
      zbyva -= p.castka;
    }
  }
  const naBanku = Math.min(zbyva, Math.max(0, (dluh && dluh.banka) || 0));
  zbyva -= naBanku;
  return { pujcky, banka: naBanku, prodavajicimu: zbyva,
    doplaceno: Math.max(0, Math.round(Number(cena) || 0)) - zbyva };
}

module.exports = { doplatek, banka, naMiste, rozdel };
