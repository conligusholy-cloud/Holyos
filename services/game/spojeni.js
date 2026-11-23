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
// Po kolika řádcích se přístupy čtou. Celý záznam se do paměti nevejde —
// půl milionu řádků najednou server položí (a padá to na 502, ne na chybu,
// kterou by bylo vidět). Čte se proto po stránkách a drží se jen to, co
// z nich zbyde: skupiny podle otisků a poslední přístup na každém zařízení.
const STRANKA = 20000;
const STRANEK_MAX = 60;

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
//
// Přístupy se čtou po stránkách a hned zpracovávají. V paměti nikdy neleží
// víc než jedna stránka: z celého záznamu zbydou jen skupiny podle otisků
// a jeden poslední přístup na každé zařízení.
async function nacti(prisma, pristupyPredem) {
  const hraci = await prisma.gamePlayer.findMany({
    select: { id: true, nick: true, company: true, dev_pid: true, reg_ip: true, disabled: true } });
  const b = zacni(hraci);
  if (Array.isArray(pristupyPredem)) {
    pristupyPredem.forEach((a) => b.pridej(a));
    return b.hotovo();
  }
  if (!prisma.gameAccess) return b.hotovo();
  const od = new Date(Date.now() - DNU * DEN);
  let cursor = null;
  for (let i = 0; i < STRANEK_MAX; i++) {
    const dotaz = { where: { created_at: { gte: od } },
      select: { player_id: true, druh: true, ref_id: true, dev: true, fp: true, hw: true, created_at: true },
      orderBy: { id: 'asc' }, take: STRANKA };
    if (cursor) { dotaz.cursor = { id: cursor }; dotaz.skip = 1; }
    // Kurzor potřebuje id — bere se zvlášť, ať se nedrží v paměti zbytečně.
    dotaz.select.id = true;
    const davka = await prisma.gameAccess.findMany(dotaz).catch(() => []);
    if (!davka.length) break;
    davka.forEach((a) => b.pridej(a));
    cursor = davka[davka.length - 1].id;
    if (davka.length < STRANKA) break;
  }
  return b.hotovo();
}

// Vlastní skládání. Postupné: řádky přístupů se přidávají po jednom a
// v paměti zůstává jen to, co z nich plyne. Díky tomu se dá celý záznam
// přečíst po stránkách a server to nepoloží.
function zacni(hraci) {
  const P = new Map();
  (hraci || []).forEach((h) => P.set(h.id, h));
  const pary = new Map();   // "a|b" → { sila, duvody: [] }
  const pridejPar = (a, b, kolik, duvod) => {
    if (!a || !b || a === b) return;
    const k = klic(a, b);
    const p = pary.get(k) || { sila: 0, duvody: [] };
    // Týž druh signálu se nesčítá dvakrát — dva účty v jednom prohlížeči
    // nejsou „dvakrát silněji" spojené, než když je to vidět jednou.
    if (p.duvody.some((d) => d.kod === duvod.kod)) { pary.set(k, p); return; }
    p.sila = Math.min(100, p.sila + kolik);
    p.duvody.push(Object.assign({ kolik }, duvod));
    pary.set(k, p);
  };

  // Skupiny podle klíčů. Drží se jen množiny id, ne řádky.
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

  // Střídání: stačí si pamatovat poslední přístup na každém zařízení.
  const posledniNaZarizeni = new Map();
  const stridani = new Map();
  // Důkaz u obchodu: kdo k němu co dělal. Týká se jen hrstky řádků.
  const kObchodu = new Map();
  const dukazy = new Map();

  return {
    pridej(a) {
      if (!a || !P.has(a.player_id)) return;
      doSkupiny(podle.fp, a.fp, a.player_id);
      doSkupiny(podle.dev, a.dev, a.player_id);
      doSkupiny(podle.hw, a.hw, a.player_id);
      const zar = a.fp || a.dev;
      if (zar) {
        const minuly = posledniNaZarizeni.get(zar);
        if (minuly && minuly.player_id !== a.player_id
          && new Date(a.created_at) - new Date(minuly.created_at) < 3 * 60e3) {
          const k = klic(minuly.player_id, a.player_id);
          stridani.set(k, (stridani.get(k) || 0) + 1);
        }
        posledniNaZarizeni.set(zar, { player_id: a.player_id, created_at: a.created_at });
      }
      if (a.ref_id && ['nabidka', 'protinavrh', 'prijeti'].indexOf(a.druh) >= 0) {
        const l = kObchodu.get(a.ref_id) || [];
        if (l.length < 40) l.push({ player_id: a.player_id, druh: a.druh, dev: a.dev, fp: a.fp });
        kObchodu.set(a.ref_id, l);
      }
    },
    hotovo() {
      const projdiSkupiny = (mapa, kolik, kod, popis) => {
        mapa.forEach((set) => {
          // Veřejná IP sdílená desítkami účtů nic neznamená — to je operátor.
          if (kod === 'ip' && set.size > 8) return;
          const ids = [...set];
          for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) pridejPar(ids[i], ids[j], kolik, { kod, text: popis });
          }
        });
      };
      projdiSkupiny(podle.fp, SILA.otisk, 'otisk', 'stejný otisk prohlížeče');
      projdiSkupiny(podle.dev, SILA.prohlizec, 'prohlizec', 'stejné id prohlížeče');
      projdiSkupiny(podle.hw, SILA.hardware, 'hardware', 'stejný model zařízení');
      projdiSkupiny(podle.ip, SILA.ip, 'ip', 'stejná registrační IP');

      // Jednou to může být náhoda (společný počítač), opakovaně ne.
      stridani.forEach((n, k) => {
        if (n < 2) return;
        const [a, b] = k.split('|').map(Number);
        pridejPar(a, b, SILA.stridani, { kod: 'stridani', text: 'na jednom zařízení se střídají (' + n + '× do 3 minut)' });
      });

      // Důkaz: nabídku (nebo protinávrh) i její přijetí udělalo totéž
      // zařízení. To už není signál, to je jeden člověk na obou stranách.
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
          pridejPar(n.player_id, p.player_id, SILA.dukaz,
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
    },
  };
}

// Pohodlný tvar pro testy a malá data: celé pole najednou.
function postav(hraci, pristupy) {
  const b = zacni(hraci);
  (pristupy || []).forEach((a) => b.pridej(a));
  return b.hotovo();
}

module.exports = { nacti, postav, zacni, PRAH, SILA, DNU, STRANKA };
