// =============================================================================
// HolyOS — Laundromat Tycoon: odhad podvodu (multi účty, přelévání strojů, provize)
// =============================================================================
// Každý hráč dostane skóre 0–99 % a seznam důvodů. Hodnotí se dvě role:
//   • POMOCNÝ ÚČET — založený jen proto, aby koupil stroj (zvoucí dostane
//     provizi), prodal ho levně dál a zmizel.
//   • PŘÍJEMCE — hráč, ke kterému levné stroje a provize z takových účtů tečou.
// Jednotlivý signál nic nedokazuje (stejná IP = mobilní operátor, rodina…),
// teprve jejich kombinace. Skóre je podklad pro člověka, nic se samo neblokuje.
// Výsledek drží 3 minuty v paměti.
// =============================================================================
'use strict';

const LIST = { mini: Math.round(35000 * 24.35 * 1.25), flex: Math.round(52000 * 24.35 * 1.25), max: Math.round(67000 * 24.35 * 1.25) };
const STROJ_PREDMET = ['stroj', 'pradlomat'];
const SMAZANY = 'smazaný hráč';
const H = 3600e3, D = 24 * H;
let cache = { at: 0, data: null, p: null };

const cenaSeznam = (t) => LIST[String(t.model || '').toLowerCase()] || LIST.mini;
const kc = (n) => Math.round(n).toLocaleString('cs-CZ');

async function spocitej(prisma) {
  const [hraci, obchody, davky, mista, pristupy] = await Promise.all([
    prisma.gamePlayer.findMany({ select: { id: true, nick: true, company: true, created_at: true, hra_s_celkem: true, dev_pid: true, reg_ip: true,
      invited_by_id: true, invited_by_ref: true, ref_id: true, disabled: true, email: true, last_login_at: true } }),
    prisma.gameTrade.findMany({ where: { stav: 'prijato', predmet: { in: STROJ_PREDMET.concat(['pobocka']) } },
      select: { id: true, from_id: true, to_id: true, smer: true, predmet: true, model: true, cena: true, created_at: true, resolved_at: true } }),
    prisma.gameDelivery.findMany({ where: { kind: 'cash', popis: { startsWith: 'Provize' } }, select: { player_id: true, spot_id: true, amount: true, created_at: true } }),
    prisma.gameSpotClaim.findMany({ select: { player_id: true, spot_id: true } }),
    // Přístupy za posledních 60 dní (services/game/pristupy.js) — před nasazením tabulky prázdné
    prisma.gameAccess ? prisma.gameAccess.findMany({ where: { created_at: { gte: new Date(Date.now() - 60 * D) } },
      select: { player_id: true, druh: true, ref_id: true, ip: true, dev: true, fp: true, hw: true, created_at: true }, orderBy: { id: 'asc' }, take: 300000 }).catch(() => []) : [],
  ]);
  // Hranice po posledním rozsudku: „zisk_po" počítá jen skutky po zahájení posledního uzavřeného případu hráče
  // (co se už soudilo, se nesoudí znovu). Celkový „zisk" zůstává pro přehled hráčů.
  const hr = {};
  try { (await prisma.gameZlocin.findMany({ where: { stav: 'uzavreno' }, select: { hlavni_id: true, zahajeno_at: true } })).forEach((x) => { const t = new Date(x.zahajeno_at).getTime(); if (!hr[x.hlavni_id] || t > hr[x.hlavni_id]) hr[x.hlavni_id] = t; }); } catch (e) { /* bez tabulky se počítá vše */ }
  const poH = (id, kdy) => !hr[id] || (kdy != null && new Date(kdy).getTime() > hr[id]);
  const P = {}, podleRef = {};
  hraci.forEach((h) => { P[h.id] = h; if (h.ref_id) podleRef[h.ref_id] = h; h._s = { mule: 0, ben: 0, duvody: [], zisk: 0, ziskPo: 0, prodalLevne: 0, koupilLevne: 0 }; });
  const zvouci = (h) => P[h.invited_by_id] || podleRef[h.invited_by_ref] || null;
  const smazan = (h) => h.nick === SMAZANY;

  // Skupiny podle zařízení a přesné IP
  const dev = {}, ip = {};
  hraci.forEach((h) => { if (h.dev_pid) (dev[h.dev_pid] = dev[h.dev_pid] || []).push(h); if (h.reg_ip) (ip[h.reg_ip] = ip[h.reg_ip] || []).push(h); });
  // Zařízení a otisky ze záznamu přístupů: dev (id prohlížeče), fp (otisk prohlížeče — silné), hw (hardware — středně silné, stejný model telefonu)
  const fpM = {}, hwM = {}, devA = {}, mojeFp = {}, mojeHw = {}, mojeDev = {};
  const pridej = (map, k, h) => { if (!k || !h) return; const s = map[k] || (map[k] = new Set()); s.add(h.id); };
  pristupy.forEach((a) => { const h = P[a.player_id]; if (!h) return;
    pridej(fpM, a.fp, h); pridej(hwM, a.hw, h); pridej(devA, a.dev, h);
    if (a.fp) (mojeFp[h.id] = mojeFp[h.id] || new Set()).add(a.fp); if (a.hw) (mojeHw[h.id] = mojeHw[h.id] || new Set()).add(a.hw); if (a.dev) (mojeDev[h.id] = mojeDev[h.id] || new Set()).add(a.dev); });
  hraci.forEach((h) => { if (h.dev_pid) pridej(devA, h.dev_pid, h); });
  const spolu = (h, map, moje) => { const s = new Set(); (moje[h.id] || []).forEach((k) => (map[k] || []).forEach((i) => s.add(i))); s.delete(h.id); return s; };
  hraci.forEach((h) => { if (h.dev_pid) (mojeDev[h.id] = mojeDev[h.id] || new Set()).add(h.dev_pid); });
  const zarSousede = (h) => { const s = spolu(h, devA, mojeDev); spolu(h, fpM, mojeFp).forEach((i) => s.add(i)); return s; };
  const sousede = (h) => { const s = zarSousede(h); (ip[h.reg_ip] || []).forEach((x) => s.add(x.id)); s.delete(h.id); return s; };

  // Provize: kdo komu za koho
  const majitel = {}; mista.forEach((m) => { majitel[m.spot_id] = m.player_id; });
  const provizeZa = {}; // pozvaný id → { komu, castka }
  davky.forEach((d) => { const m = /^nakup:(\d+):/.exec(String(d.spot_id || '')); const za = m ? Number(m[1]) : majitel[d.spot_id]; if (!za) return;
    const z = provizeZa[za] || (provizeZa[za] = { komu: d.player_id, castka: 0, castkaPo: 0 }); z.castka += Number(d.amount) || 0; if (poH(d.player_id, d.created_at)) z.castkaPo += Number(d.amount) || 0; });

  // Obchody: kdo prodal komu, za kolik vůči ceníku
  const prodeje = obchody.map((t) => {
    const prod = t.smer === 'koupim' ? t.to_id : t.from_id, kup = t.smer === 'koupim' ? t.from_id : t.to_id;
    const kdy = new Date(t.resolved_at || t.created_at).getTime();
    const pomer = STROJ_PREDMET.includes(t.predmet) ? (Number(t.cena) || 0) / cenaSeznam(t) : null;
    return { id: t.id, prod: P[prod], kup: P[kup], cena: Number(t.cena) || 0, pomer, seznam: STROJ_PREDMET.includes(t.predmet) ? cenaSeznam(t) : 0, kdy };
  }).filter((x) => x.prod && x.kup);

  // ── DŮKAZY ze záznamu přístupů ──
  // a) Obchod: nabídku (nebo protinávrh) i přijetí udělalo stejné zařízení / stejný otisk → jeden člověk na obou stranách
  const zaObchod = {}; pristupy.forEach((a) => { if (a.ref_id && ['nabidka', 'protinavrh', 'prijeti'].includes(a.druh)) (zaObchod[a.ref_id] = zaObchod[a.ref_id] || []).push(a); });
  const jedenClovek = {}; // player id → [{ s: druhý, obchod, jak }]
  obchody.forEach((t) => { const l = zaObchod[t.id] || []; const nab = l.filter((a) => a.druh !== 'prijeti'), pri = l.filter((a) => a.druh === 'prijeti');
    nab.forEach((n) => pri.forEach((p) => { if (n.player_id === p.player_id) return;
      const jak = (n.dev && n.dev === p.dev) ? 'stejné id prohlížeče' : (n.fp && n.fp === p.fp) ? 'stejný otisk prohlížeče' : null;
      if (!jak) return;
      [[n.player_id, p.player_id], [p.player_id, n.player_id]].forEach(([a, b]) => (jedenClovek[a] = jedenClovek[a] || []).push({ s: b, obchod: t.id, jak })); })); });
  // b) Střídání: na stejném zařízení skončí účet A a do 3 minut je aktivní účet B (opakovaně)
  const stridani = {}; // "a|b" → počet
  const poZar = {}; pristupy.forEach((a) => { const k = a.fp || a.dev; if (k) (poZar[k] = poZar[k] || []).push(a); });
  Object.keys(poZar).forEach((k) => { const l = poZar[k]; for (let i = 1; i < l.length; i++) {
    const a = l[i - 1], b = l[i]; if (a.player_id === b.player_id) continue;
    if (new Date(b.created_at) - new Date(a.created_at) < 3 * 60e3) { const kl = Math.min(a.player_id, b.player_id) + '|' + Math.max(a.player_id, b.player_id); stridani[kl] = (stridani[kl] || 0) + 1; } } });
  const striduje = {}; Object.keys(stridani).forEach((kl) => { const [a, b] = kl.split('|').map(Number); [[a, b], [b, a]].forEach(([x, y]) => (striduje[x] = striduje[x] || []).push({ s: y, n: stridani[kl] })); });

  // Kdo skupuje levné stroje od více různých účtů (sběrač)
  const sberac = {};
  prodeje.filter((x) => x.pomer != null && x.pomer < 0.3).forEach((x) => { (sberac[x.kup.id] = sberac[x.kup.id] || new Set()).add(x.prod.id); });

  // ── 1) POMOCNÝ ÚČET ──
  hraci.forEach((h) => {
    const s = h._s, d = (b, txt) => { s.mule += b; s.duvody.push({ r: 'pomocný', b, txt }); };
    const naZar = zarSousede(h).size, naHw = spolu(h, hwM, mojeHw).size, naIp = h.reg_ip ? (ip[h.reg_ip] || []).length - 1 : 0;
    if (naZar >= 3) d(25, 'na stejném zařízení dalších ' + naZar + ' účtů'); else if (naZar >= 1) d(15, 'na stejném zařízení ještě ' + naZar + ' účet/y');
    else if (naHw >= 1) d(8, 'stejný hardware (model zařízení) jako ' + naHw + ' účt(y) — středně silné');
    else if (naIp >= 3) d(6, 'ze stejné IP dalších ' + naIp + ' účtů (slabé — může být mobilní operátor)');
    const t0 = new Date(h.created_at).getTime();
    const davka = [...sousede(h)].map((i) => P[i]).filter((x) => Math.abs(new Date(x.created_at).getTime() - t0) < 3 * H).length;
    if (davka >= 2) d(10, 'založen v dávce — ' + davka + ' účtů ze stejného zařízení/IP do 3 h');
    const s30 = h.hra_s_celkem || 0;
    if (s30 < 600) d(15, 'hrál jen ' + Math.round(s30 / 60) + ' min'); else if (s30 < 1800) d(8, 'hrál jen ' + Math.round(s30 / 60) + ' min');
    if (smazan(h)) d(8, 'účet si sám smazal');
    const z = zvouci(h);
    const moje = prodeje.filter((x) => x.prod.id === h.id && x.pomer != null);
    const levne = moje.filter((x) => x.pomer < 0.3), polo = moje.filter((x) => x.pomer >= 0.3 && x.pomer < 0.6);
    s.prodalLevne = levne.length;
    if (levne.length) d(25, 'prodal ' + levne.length + '× stroj pod 30 % ceny (' + levne.map((x) => Math.round(x.pomer * 100) + ' %').slice(0, 4).join(', ') + ')');
    else if (polo.length) d(10, 'prodal ' + polo.length + '× stroj za 30–60 % ceny');
    const nas = sousede(h);
    const komuSvemu = moje.filter((x) => (z && x.kup.id === z.id) || nas.has(x.kup.id) || (z && zvouci(x.kup) && zvouci(x.kup).id === z.id));
    if (komuSvemu.length) d(15, 'stroje prodal ' + (z && komuSvemu.some((x) => x.kup.id === z.id) ? 'tomu, kdo ho pozval' : 'účtu ze svého okruhu'));
    const kSberaci = levne.filter((x) => sberac[x.kup.id] && sberac[x.kup.id].size >= 3 && !komuSvemu.includes(x));
    if (kSberaci.length) d(10, 'levně prodal hráči ' + kSberaci[0].kup.nick + ', který takto skoupil stroje od ' + sberac[kSberaci[0].kup.id].size + ' účtů');
    if (z && (nas.has(z.id) || moje.some((x) => x.kup.id === z.id))) d(10, 'zvoucí (' + z.nick + ') je ze stejného zařízení/IP nebo kupec');
    const jc = jedenClovek[h.id] || [];
    if (jc.length) { s.dukaz = true; const b = Math.min(60, 40 + (jc.length - 1) * 5); s.mule += 0; s.ben += 0;
      s.duvody.push({ r: 'důkaz', b, txt: 'obchod ' + [...new Set(jc.map((x) => '#' + x.obchod))].slice(0, 3).join(', ') + ' s hráčem ' + [...new Set(jc.map((x) => (P[x.s] || {}).nick || '?'))].slice(0, 3).join(', ') + ' — nabídku i přijetí udělalo ' + jc[0].jak + ' (jeden člověk na obou stranách)' });
      s.dukazB = b; }
    const st = (striduje[h.id] || []).filter((x) => x.n >= 2);
    if (st.length) { const b = st.some((x) => x.n >= 4) ? 25 : 15; s.duvody.push({ r: 'důkaz', b, txt: 'na stejném zařízení se střídá s ' + st.slice(0, 3).map((x) => ((P[x.s] || {}).nick || '?') + ' (' + x.n + '× do 3 min)').join(', ') }); s.stridaniB = b; }
    if (provizeZa[h.id] && (levne.length || smazan(h) || s30 < 1800)) d(5, 'vygeneroval provizi ' + kc(provizeZa[h.id].castka) + ' L$ pro ' + ((P[provizeZa[h.id].komu] || {}).nick || '?'));
    // Pro koho pracuje: komu šla provize, jinak kdo od něj levně koupil
    const proKoho = (provizeZa[h.id] && P[provizeZa[h.id].komu]) || (levne[0] && levne[0].kup) || null;
    if (proKoho && proKoho.id !== h.id) s.pro = proKoho.nick;
  });
  const jeMule = (h) => h._s.mule >= 45;

  // ── 2) PŘÍJEMCE ──
  hraci.forEach((h) => {
    const s = h._s, d = (b, txt) => { s.ben += b; s.duvody.push({ r: 'příjemce', b, txt }); };
    const koupe = prodeje.filter((x) => x.kup.id === h.id && x.pomer != null && x.pomer < 0.3);
    s.koupilLevne = koupe.length;
    if (koupe.length) {
      d(koupe.length >= 10 ? 45 : koupe.length >= 3 ? 35 : 20, 'koupil ' + koupe.length + '× stroj pod 30 % ceny');
      const slevaL = koupe.reduce((a, x) => a + Math.max(0, x.seznam - x.cena), 0);
      s.zisk += slevaL; s.sleva = (s.sleva || 0) + slevaL;
      s.ziskPo += koupe.filter((x) => poH(h.id, x.kdy)).reduce((a, x) => a + Math.max(0, x.seznam - x.cena), 0);
      const mladi = koupe.filter((x) => x.kdy - new Date(x.prod.created_at).getTime() < 2 * D || smazan(x.prod) || jeMule(x.prod));
      if (mladi.length) d(mladi.length >= 3 ? 25 : 15, mladi.length + '× od účtu mladšího 2 dnů / smazaného / pomocného');
    }
    // Levnější nákup (30–60 % ceníku) od nového účtu (do 7 dní věku), smazaného nebo pomocného
    const polo = prodeje.filter((x) => x.kup.id === h.id && x.pomer != null && x.pomer >= 0.3 && x.pomer < 0.6
      && (x.kdy - new Date(x.prod.created_at).getTime() < 7 * D || smazan(x.prod) || jeMule(x.prod)));
    if (polo.length) {
      d(polo.length >= 5 ? 20 : polo.length >= 2 ? 12 : 6, 'koupil ' + polo.length + '× stroj za 30–60 % ceny od nového / smazaného / pomocného účtu');
      const slevaP = polo.reduce((a, x) => a + Math.max(0, x.seznam - x.cena), 0);
      s.zisk += slevaP; s.sleva = (s.sleva || 0) + slevaP; s.koupilLevne += polo.length;
      s.ziskPo += polo.filter((x) => poH(h.id, x.kdy)).reduce((a, x) => a + Math.max(0, x.seznam - x.cena), 0);
    }
    const pozvani = hraci.filter((x) => zvouci(x) && zvouci(x).id === h.id && provizeZa[x.id] && provizeZa[x.id].komu === h.id);
    const podezreli = pozvani.filter((x) => jeMule(x) || smazan(x) || (x.hra_s_celkem || 0) < 1800 || x._s.prodalLevne);
    if (podezreli.length) {
      d(podezreli.length >= 10 ? 35 : podezreli.length >= 3 ? 25 : 12, 'provize za ' + podezreli.length + ' podezřelých pozvaných (smazaní / krátká hra / levný prodej)');
      const prov = podezreli.reduce((a, x) => a + provizeZa[x.id].castka, 0);
      s.zisk += prov; s.provize = prov; s.ziskPo += podezreli.reduce((a, x) => a + provizeZa[x.id].castkaPo, 0); s.pomocnych = podezreli.length; s.pozvanych = pozvani.length;
    }
    if (pozvani.length >= 3 && podezreli.length / pozvani.length >= 0.8) d(20, podezreli.length + ' z ' + pozvani.length + ' jeho pozvaných jsou podezřelé účty');
    // Stejné zařízení je silná stopa, samotná stejná IP slabá (mobilní operátor, rodina, kolej)
    const zs = zarSousede(h); const muleZar = [...zs].filter((i) => jeMule(P[i])).length;
    const muleIp = h.reg_ip ? (ip[h.reg_ip] || []).filter((x) => x.id !== h.id && jeMule(x) && !zs.has(x.id)).length : 0;
    if (muleZar) d(20, 'sdílí zařízení s ' + muleZar + ' pomocnými účty'); else if (muleIp) d(4, 'stejná IP jako ' + muleIp + ' pomocných účtů (slabé)');
    if (s.zisk > 5e6) d(10, 'neoprávněný zisk ≈ ' + kc(s.zisk) + ' L$'); else if (s.zisk > 1e6) d(5, 'neoprávněný zisk ≈ ' + kc(s.zisk) + ' L$');
  });

  const out = {};
  hraci.forEach((h) => {
    const s = h._s, dk = (s.dukazB || 0) + (s.stridaniB || 0), mule = Math.min(99, s.mule + dk), ben = Math.min(99, s.ben + dk), pct = Math.max(mule, ben);
    // PODVODNÍK = ten, kdo bere provize z účelových účtů a/nebo skupuje od nových účtů stroje pod cenou.
    // Pomocný účet je jen nástroj; tomu se píše, pro koho pracuje.
    const podvodnik = ben >= 45 && ben >= mule && ((s.provize || 0) > 0 || (s.sleva || 0) > 0);
    out[h.id] = { pct, dukaz: !!s.dukaz, podvodnik, role: pct < 20 ? null : (podvodnik ? 'PODVODNÍK' : ben > mule ? 'příjemce' : 'pomocný účet'), mule, ben, zisk: Math.round(s.zisk), zisk_po: Math.round(s.ziskPo),
      provize: Math.round(s.provize || 0), sleva: Math.round(s.sleva || 0), pomocnych: s.pomocnych || 0, pozvanych: s.pozvanych || 0,
      levnych: s.koupilLevne || 0, pro: (!podvodnik && mule >= 45) ? (s.pro || null) : null,
      // Kdo ho přivedl (null = nikdo), s kým sdílí zařízení/IP a komu prodával stroje — admin to vidí přímo v tabulce.
      pozval: (zvouci(h) || {}).nick || null,
      souvisi: [...sousede(h)].map((i) => P[i]).filter(Boolean).slice(0, 5).map((x) => x.nick),
      prodal: prodeje.filter((x) => x.prod.id === h.id).sort((a, b) => b.kdy - a.kdy).slice(0, 6).map((x) => ({
        komu: x.kup.company || x.kup.nick, nick: x.kup.nick, cena: Math.round(x.cena),
        pct: x.pomer != null ? Math.round(x.pomer * 100) : null,
        okruh: !!(sousede(h).has(x.kup.id) || (zvouci(h) && zvouci(h).id === x.kup.id)) })),
      duvody: s.duvody.sort((a, b) => b.b - a.b).slice(0, 10) };
  });
  return out;
}

async function skore(prisma) {
  if (cache.data && Date.now() - cache.at < 3 * 60e3) return cache.data;
  if (cache.p) return cache.p;
  cache.p = spocitej(prisma).then((d) => { cache = { at: Date.now(), data: d, p: null }; return d; }).catch((e) => { cache.p = null; throw e; });
  return cache.p;
}

module.exports = { skore };
