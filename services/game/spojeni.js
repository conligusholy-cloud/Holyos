// =============================================================================
// Laundromat Tycoon — kdo s kým je jeden člověk
// =============================================================================
// Podvody ve hře mají skoro vždycky stejný základ: jeden člověk hraje za víc
// účtů a obchoduje sám se sebou. Dokud se spojení počítalo pokaždé znovu
// uvnitř jednoho souboru, uměl ho použít jen on. Tohle je společný základ
// pro všechny detektory i pro řízení o zločinu.
//
// Síla spojení je 0–100 a skládá se ze signálů, které se liší spolehlivostí:
//   · otisk prohlížeče nebo id prohlížeče  — silné, dva účty v jednom prohlížeči
//   · obchod, kde nabídku i přijetí udělalo totéž zařízení — důkaz
//   · střídání účtů na jednom zařízení do tří minut — silné, když se opakuje
//   · stejný hardware (model telefonu) — střední
//   · stejná registrační IP — slabé, může to být operátor nebo rodina
//
// Žádný signál sám o sobě nic nedokazuje. Proto se sčítají a teprve součet
// nad prahem znamená „jeden člověk". Práh si volá každý detektor sám podle
// toho, jak drahé je jeho rozhodnutí.
'use strict';

const DEN = 24 * 3600e3;
// Kolik dní zpátky se čtou přístupy. Dál do minulosti to nemá cenu: účty se
// mezitím mažou a otisky prohlížeče se mění.
const DNU = 60;

const SILA = {
  dukaz: 60,        // nabídku i přijetí téhož obchodu udělalo jedno zařízení
  otisk: 40,        // stejný otisk prohlížeče
  prohlizec: 40,    // stejné id prohlížeče
  stridani: 25,     // účty se na jednom zařízení střídají do 3 minut
  hardware: 12,     // stejný model zařízení
  ip: 6,            // stejná registrační IP
};
// Nad tímhle součtem bereme dva účty jako jednoho člověka. Dva slabé signály
// (hardware + IP) nestačí — na to, aby se kvůli tomu někomu zmrazil majetek,
// je potřeba aspoň jeden silný.
const PRAH = 40;

const klic = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

// Načte spojení mezi účty. Vrací objekt s dotazy, ne holá data — ať se
// detektory nemusí starat o to, jak je to uvnitř poskládané.
async function nacti(prisma, pristupyPredem) {
  const [hraci, pristupy] = await Promise.all([
    prisma.gamePlayer.findMany({ select: { id: true, nick: true, company: true, dev_pid: true, reg_ip: true, disabled: true } }),
    pristupyPredem || (prisma.gameAccess
      ? prisma.gameAccess.findMany({
        where: { created_at: { gte: new Date(Date.now() - DNU * DEN) } },
        select: { player_id: true, druh: true, ref_id: true, ip: true, dev: true, fp: true, hw: true, created_at: true },
        orderBy: { id: 'asc' }, take: 300000 }).catch(() => [])
      : []),
  ]);
  return postav(hraci, pristupy);
}

// Vlastní skládání — bez databáze, ať se dá testovat.
function postav(hraci, pristupy) {
  const P = new Map();
  (hraci || []).forEach((h) => P.set(h.id, h));
  const pary = new Map();   // "a|b" → { sila, duvody: [] }
  const pridej = (a, b, kolik, duvod) => {
    if (!a || !b || a === b) return;
    const k = klic(a, b);
    const p = pary.get(k) || { sila: 0, duvody: [] };
    // Týž druh signálu se nesčítá dvakrát — dva účty v jednom prohlížeči
    // nejsou „dvakrát silněji" spojené, než když je to vidět jednou.
    if (p.duvody.some((d) => d.kod === duvod.kod)) {
      if (duvod.text && !p.duvody.some((d) => d.text === duvod.text)) {
        p.duvody.push(Object.assign({}, duvod, { kolik: 0 }));
      }
      pary.set(k, p);
      return;
    }
    p.sila = Math.min(100, p.sila + kolik);
    p.duvody.push(Object.assign({ kolik }, duvod));
    pary.set(k, p);
  };

  // Skupiny podle klíčů z přístupů i z registrace.
  const podle = { fp: new Map(), dev: new Map(), hw: new Map(), ip: new Map() };
  const doSkupiny = (mapa, hodnota, id) => {
    if (!hodnota || !id) return;
    const s = mapa.get(hodnota) || new Set();
    s.add(id); mapa.set(hodnota, s);
  };
  (hraci || []).forEach((h) => {
    doSkupiny(podle.dev, h.dev_pid, h.id);
    doSkupiny(podle.ip, h.reg_ip, h.id);
  });
  (pristupy || []).forEach((a) => {
    if (!P.has(a.player_id)) return;
    doSkupiny(podle.fp, a.fp, a.player_id);
    doSkupiny(podle.dev, a.dev, a.player_id);
    doSkupiny(podle.hw, a.hw, a.player_id);
  });
  const projdiSkupiny = (mapa, kolik, kod, popis) => {
    mapa.forEach((set, hodnota) => {
      // Veřejná IP sdílená desítkami účtů nic neznamená — to je operátor.
      if (kod === 'ip' && set.size > 8) return;
      const ids = [...set];
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          pridej(ids[i], ids[j], kolik, { kod, text: popis });
        }
      }
    });
  };
  projdiSkupiny(podle.fp, SILA.otisk, 'otisk', 'stejný otisk prohlížeče');
  projdiSkupiny(podle.dev, SILA.prohlizec, 'prohlizec', 'stejné id prohlížeče');
  projdiSkupiny(podle.hw, SILA.hardware, 'hardware', 'stejný model zařízení');
  projdiSkupiny(podle.ip, SILA.ip, 'ip', 'stejná registrační IP');

  // Střídání účtů na jednom zařízení: A skončí a do tří minut je aktivní B.
  // Jednou to může být náhoda (společný počítač), opakovaně ne.
  const poZarizeni = new Map();
  (pristupy || []).forEach((a) => {
    const k = a.fp || a.dev;
    if (!k || !P.has(a.player_id)) return;
    const l = poZarizeni.get(k) || []; l.push(a); poZarizeni.set(k, l);
  });
  const stridani = new Map();
  poZarizeni.forEach((l) => {
    for (let i = 1; i < l.length; i++) {
      const a = l[i - 1], b = l[i];
      if (a.player_id === b.player_id) continue;
      if (new Date(b.created_at) - new Date(a.created_at) >= 3 * 60e3) continue;
      const k = klic(a.player_id, b.player_id);
      stridani.set(k, (stridani.get(k) || 0) + 1);
    }
  });
  stridani.forEach((n, k) => {
    if (n < 2) return;
    const [a, b] = k.split('|').map(Number);
    pridej(a, b, SILA.stridani, { kod: 'stridani', text: 'na jednom zařízení se střídají (' + n + '× do 3 minut)' });
  });

  // Důkaz: nabídku (nebo protinávrh) i její přijetí udělalo totéž zařízení.
  // To už není signál, to je jeden člověk na obou stranách obchodu.
  const kObchodu = new Map();
  (pristupy || []).forEach((a) => {
    if (!a.ref_id || ['nabidka', 'protinavrh', 'prijeti'].indexOf(a.druh) < 0) return;
    const l = kObchodu.get(a.ref_id) || []; l.push(a); kObchodu.set(a.ref_id, l);
  });
  const dukazy = new Map();   // "a|b" → [id obchodu]
  kObchodu.forEach((l, obchod) => {
    const nab = l.filter((a) => a.druh !== 'prijeti');
    const pri = l.filter((a) => a.druh === 'prijeti');
    nab.forEach((n) => pri.forEach((p) => {
      if (n.player_id === p.player_id) return;
      const jak = (n.dev && n.dev === p.dev) ? 'stejné id prohlížeče'
        : (n.fp && n.fp === p.fp) ? 'stejný otisk prohlížeče' : null;
      if (!jak) return;
      const k = klic(n.player_id, p.player_id);
      const l2 = dukazy.get(k) || []; if (l2.indexOf(obchod) < 0) l2.push(obchod); dukazy.set(k, l2);
      pridej(n.player_id, p.player_id, SILA.dukaz,
        { kod: 'dukaz', text: 'obchod #' + obchod + ' — nabídku i přijetí udělalo ' + jak });
    }));
  });

  const sousede = new Map();
  pary.forEach((p, k) => {
    if (p.sila < PRAH) return;
    const [a, b] = k.split('|').map(Number);
    (sousede.get(a) || sousede.set(a, new Set()).get(a)).add(b);
    (sousede.get(b) || sousede.set(b, new Set()).get(b)).add(a);
  });

  return {
    PRAH, SILA,
    hraci: P,
    // Síla spojení dvou účtů, 0 = nic.
    sila(a, b) { const p = pary.get(klic(a, b)); return p ? p.sila : 0; },
    // Jeden člověk? Práh se dá zpřísnit tomu, kdo na tom staví drahé rozhodnutí.
    jedenClovek(a, b, prah) { return this.sila(a, b) >= (prah == null ? PRAH : prah); },
    duvody(a, b) { const p = pary.get(klic(a, b)); return p ? p.duvody.slice() : []; },
    // Krátká věta do případu: čím je spojení doložené.
    popis(a, b) {
      return this.duvody(a, b).filter((d) => d.kolik > 0)
        .sort((x, y) => y.kolik - x.kolik).map((d) => d.text).slice(0, 3).join('; ');
    },
    maDukaz(a, b) { return (dukazy.get(klic(a, b)) || []).length > 0; },
    // Účty spojené s tímhle, nad prahem.
    okruh(id) { return new Set(sousede.get(id) || []); },
    // Celá skupina účtů jednoho člověka (i přes prostředníka).
    skupina(id) {
      const ven = new Set([id]); const fronta = [id];
      while (fronta.length) {
        const x = fronta.shift();
        (sousede.get(x) || new Set()).forEach((y) => { if (!ven.has(y)) { ven.add(y); fronta.push(y); } });
      }
      return ven;
    },
    pary,
  };
}

module.exports = { nacti, postav, PRAH, SILA, DNU };
