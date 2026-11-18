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
  const [hraci, obchody, davky, mista] = await Promise.all([
    prisma.gamePlayer.findMany({ select: { id: true, nick: true, created_at: true, hra_s_celkem: true, dev_pid: true, reg_ip: true,
      invited_by_id: true, invited_by_ref: true, ref_id: true, disabled: true, email: true, last_login_at: true } }),
    prisma.gameTrade.findMany({ where: { stav: 'prijato', predmet: { in: STROJ_PREDMET.concat(['pobocka']) } },
      select: { id: true, from_id: true, to_id: true, smer: true, predmet: true, model: true, cena: true, created_at: true, resolved_at: true } }),
    prisma.gameDelivery.findMany({ where: { kind: 'cash', popis: { startsWith: 'Provize' } }, select: { player_id: true, spot_id: true, amount: true } }),
    prisma.gameSpotClaim.findMany({ select: { player_id: true, spot_id: true } }),
  ]);
  const P = {}, podleRef = {};
  hraci.forEach((h) => { P[h.id] = h; if (h.ref_id) podleRef[h.ref_id] = h; h._s = { mule: 0, ben: 0, duvody: [], zisk: 0, prodalLevne: 0, koupilLevne: 0 }; });
  const zvouci = (h) => P[h.invited_by_id] || podleRef[h.invited_by_ref] || null;
  const smazan = (h) => h.nick === SMAZANY;

  // Skupiny podle zařízení a přesné IP
  const dev = {}, ip = {};
  hraci.forEach((h) => { if (h.dev_pid) (dev[h.dev_pid] = dev[h.dev_pid] || []).push(h); if (h.reg_ip) (ip[h.reg_ip] = ip[h.reg_ip] || []).push(h); });
  const sousede = (h) => { const s = new Set(); (dev[h.dev_pid] || []).forEach((x) => s.add(x.id)); (ip[h.reg_ip] || []).forEach((x) => s.add(x.id)); s.delete(h.id); return s; };

  // Provize: kdo komu za koho
  const majitel = {}; mista.forEach((m) => { majitel[m.spot_id] = m.player_id; });
  const provizeZa = {}; // pozvaný id → { komu, castka }
  davky.forEach((d) => { const m = /^nakup:(\d+):/.exec(String(d.spot_id || '')); const za = m ? Number(m[1]) : majitel[d.spot_id]; if (!za) return;
    const z = provizeZa[za] || (provizeZa[za] = { komu: d.player_id, castka: 0 }); z.castka += Number(d.amount) || 0; });

  // Obchody: kdo prodal komu, za kolik vůči ceníku
  const prodeje = obchody.map((t) => {
    const prod = t.smer === 'koupim' ? t.to_id : t.from_id, kup = t.smer === 'koupim' ? t.from_id : t.to_id;
    const kdy = new Date(t.resolved_at || t.created_at).getTime();
    const pomer = STROJ_PREDMET.includes(t.predmet) ? (Number(t.cena) || 0) / cenaSeznam(t) : null;
    return { prod: P[prod], kup: P[kup], cena: Number(t.cena) || 0, pomer, seznam: STROJ_PREDMET.includes(t.predmet) ? cenaSeznam(t) : 0, kdy };
  }).filter((x) => x.prod && x.kup);

  // Kdo skupuje levné stroje od více různých účtů (sběrač)
  const sberac = {};
  prodeje.filter((x) => x.pomer != null && x.pomer < 0.3).forEach((x) => { (sberac[x.kup.id] = sberac[x.kup.id] || new Set()).add(x.prod.id); });

  // ── 1) POMOCNÝ ÚČET ──
  hraci.forEach((h) => {
    const s = h._s, d = (b, txt) => { s.mule += b; s.duvody.push({ r: 'pomocný', b, txt }); };
    const naZar = h.dev_pid ? (dev[h.dev_pid] || []).length - 1 : 0, naIp = h.reg_ip ? (ip[h.reg_ip] || []).length - 1 : 0;
    if (naZar >= 3) d(25, 'na stejném zařízení dalších ' + naZar + ' účtů'); else if (naZar >= 1) d(15, 'na stejném zařízení ještě ' + naZar + ' účet/y');
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
    if (provizeZa[h.id] && (levne.length || smazan(h) || s30 < 1800)) d(5, 'vygeneroval provizi ' + kc(provizeZa[h.id].castka) + ' L$ pro ' + ((P[provizeZa[h.id].komu] || {}).nick || '?'));
  });
  const jeMule = (h) => h._s.mule >= 45;

  // ── 2) PŘÍJEMCE ──
  hraci.forEach((h) => {
    const s = h._s, d = (b, txt) => { s.ben += b; s.duvody.push({ r: 'příjemce', b, txt }); };
    const koupe = prodeje.filter((x) => x.kup.id === h.id && x.pomer != null && x.pomer < 0.3);
    s.koupilLevne = koupe.length;
    if (koupe.length) {
      d(koupe.length >= 10 ? 45 : koupe.length >= 3 ? 35 : 20, 'koupil ' + koupe.length + '× stroj pod 30 % ceny');
      s.zisk += koupe.reduce((a, x) => a + Math.max(0, x.seznam - x.cena), 0);
      const mladi = koupe.filter((x) => x.kdy - new Date(x.prod.created_at).getTime() < 2 * D || smazan(x.prod) || jeMule(x.prod));
      if (mladi.length) d(mladi.length >= 3 ? 25 : 15, mladi.length + '× od účtu mladšího 2 dnů / smazaného / pomocného');
    }
    const pozvani = hraci.filter((x) => zvouci(x) && zvouci(x).id === h.id && provizeZa[x.id] && provizeZa[x.id].komu === h.id);
    const podezreli = pozvani.filter((x) => jeMule(x) || smazan(x) || (x.hra_s_celkem || 0) < 1800 || x._s.prodalLevne);
    if (podezreli.length) {
      d(podezreli.length >= 10 ? 35 : podezreli.length >= 3 ? 25 : 12, 'provize za ' + podezreli.length + ' podezřelých pozvaných (smazaní / krátká hra / levný prodej)');
      s.zisk += podezreli.reduce((a, x) => a + provizeZa[x.id].castka, 0);
    }
    if (pozvani.length >= 3 && podezreli.length / pozvani.length >= 0.8) d(20, podezreli.length + ' z ' + pozvani.length + ' jeho pozvaných jsou podezřelé účty');
    // Stejné zařízení je silná stopa, samotná stejná IP slabá (mobilní operátor, rodina, kolej)
    const muleZar = h.dev_pid ? (dev[h.dev_pid] || []).filter((x) => x.id !== h.id && jeMule(x)).length : 0;
    const muleIp = h.reg_ip ? (ip[h.reg_ip] || []).filter((x) => x.id !== h.id && jeMule(x) && x.dev_pid !== h.dev_pid).length : 0;
    if (muleZar) d(20, 'sdílí zařízení s ' + muleZar + ' pomocnými účty'); else if (muleIp) d(4, 'stejná IP jako ' + muleIp + ' pomocných účtů (slabé)');
    if (s.zisk > 5e6) d(10, 'neoprávněný zisk ≈ ' + kc(s.zisk) + ' L$'); else if (s.zisk > 1e6) d(5, 'neoprávněný zisk ≈ ' + kc(s.zisk) + ' L$');
  });

  const out = {};
  hraci.forEach((h) => {
    const s = h._s, mule = Math.min(99, s.mule), ben = Math.min(99, s.ben), pct = Math.max(mule, ben);
    out[h.id] = { pct, role: pct < 20 ? null : (ben > mule ? 'příjemce' : 'pomocný účet'), mule, ben, zisk: Math.round(s.zisk),
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
