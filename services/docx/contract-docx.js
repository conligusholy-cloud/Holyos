// HolyOS — naplnění DOCX šablon smluv (kupní, nájemní, přílohy 1–3) daty rezervace/kontaktu,
// lokality (Compounding) a SIS (příloha 3). Vrací pole { name, buffer }.
const path = require('path');
const PizZip = require('pizzip');
const { fillDocxFile } = require('./docx-fill');

const TPL_DIR = path.join(__dirname, '..', '..', 'templates', 'contracts');
const norm = (s) => String(s == null ? '' : s).replace(/[\s ]/g, '');
const kc = (n) => (n == null || !isFinite(n)) ? '' : (Math.round(Number(n)).toLocaleString('cs-CZ') + ' Kč');
// pravidlo: přesná shoda textu (po normalizaci mezer/nbsp)
const eq = (want, val) => ({ test: (t) => norm(t) === norm(want), build: () => val });
// pravidlo: text obsahuje podřetězec (pro dlouhé odstavce s lokalitou apod.)
const has = (sub, buildFn) => ({ test: (t) => t.indexOf(sub) >= 0, build: buildFn });

function partyBlock(lines) { return lines.filter((x) => x != null && x !== '').join('\n'); }

// f = kompletní data (viz route). Vrací [{name, buffer}].
function fillContracts(f) {
  const seller = f.seller || {};
  const buyer = f.buyer || {};
  const loc = f.locationAddr || '';
  const locName = f.locationName || f.locationCode || '';
  const files = [];

  // ── KUPNÍ ──
  const kupniRules = [
    has('číslo kupní smlouvy', () => 'KUPNÍ SMLOUVA\nčíslo kupní smlouvy - ' + (f.kupniNo || '')),
    { test: (t) => t.indexOf('(dále jen „Prodávající') >= 0, build: () => partyBlock([
      seller.name, seller.sidlo ? ('se sídlem: ' + seller.sidlo) : 'se sídlem: [●]',
      'IČO: ' + (seller.ico || '[●]') + '   DIČ: ' + (seller.dic || '[●]'),
      'zastoupená: ' + (seller.rep || '[●]'), 'bankovní spojení: ' + (seller.bank || '[●]'), '(dále jen „Prodávající“)']) },
    { test: (t) => t.indexOf('(dále jen „Kupující') >= 0, build: () => partyBlock([
      buyer.name || '[jméno / obchodní firma]', 'se sídlem / bydlištěm: ' + (buyer.sidlo || '[●]'),
      'IČO: ' + (buyer.ico || '[●]') + '   DIČ: ' + (buyer.dic || '[●]'),
      'zastoupený/á: ' + (buyer.rep || '[●]'), 'bankovní spojení: ' + (buyer.bank || '[●]'), '(dále jen „Kupující“)']) },
    has('b) Lokalita - konkrétní provozní místo', () => 'b) Lokalita - konkrétní provozní místo ' + loc + ', není-li v Příloze č. 3 nebo dodatku této smlouvy uvedeno jinak;'),
  ];
  if (f.priceMachine != null) kupniRules.push(eq('1 252 850 Kč bez DPH', kc(f.priceMachine) + ' bez DPH'));
  if (f.priceLocation != null) kupniRules.push(eq('328 850 Kč bez DPH', kc(f.priceLocation) + ' bez DPH'));
  if (f.priceTotal != null) kupniRules.push(eq('1 584 130 Kč bez DPH', kc(f.priceTotal) + ' bez DPH'));
  if (f.fee != null) kupniRules.push(has('rezervační poplatek ve výši', () => '6. Byla-li k této obchodní transakci uzavřena rezervační smlouva, započítává se uhrazený rezervační poplatek ve výši ' + kc(f.fee) + ' na celkovou cenu podle tohoto článku'));
  files.push({ name: 'Kupni_smlouva_' + (f.buyerSlug || '') + '_' + (f.kupniNo || '') + '.docx', buffer: fillDocxFile(path.join(TPL_DIR, 'kupni.docx'), kupniRules) });

  // ── NÁJEMNÍ ──
  const najemniRules = [
    eq('smlouva číslo: 2026N0002', 'smlouva číslo: ' + (f.najemniNo || '')),
    { test: (t) => t.indexOf('(dále jen „Pronajímatel') >= 0, build: () => partyBlock([
      buyer.name || '[jméno / obchodní firma]', 'se sídlem / bydlištěm: ' + (buyer.sidlo || '[●]'),
      'IČO / datum narození: ' + (buyer.ico || '[●]'), 'DIČ: ' + (buyer.dic || '[●]'),
      'zastoupený/á: ' + (buyer.rep || '[●]'), 'bankovní spojení: ' + (buyer.bank || '[●]'),
      'e-mail: ' + (buyer.email || '[●]'), '(dále jen „Pronajímatel“)']) },
    { test: (t) => t.indexOf('(dále jen „Nájemce') >= 0, build: () => partyBlock([
      seller.name, 'se sídlem: ' + (seller.sidlo || '[●]'), 'IČO: ' + (seller.ico || '[●]') + ', DIČ: ' + (seller.dic || '[●]'),
      'zastoupená: ' + (seller.rep || '[●]'), 'bankovní spojení: ' + (seller.bank || '[●]'),
      'e-mail: ' + (seller.email || '[●]'), '(dále jen „Nájemce“ nebo „Provozovatel“)']) },
    has('c) Lokalita – primární provozní místo', () => 'c) Lokalita – primární provozní místo ' + loc + ', není-li písemně sjednáno nebo v souladu s touto smlouvou určeno jinak;'),
    has('1. Primární Lokalitou pro provoz Stroje je', () => '1. Primární Lokalitou pro provoz Stroje je ' + loc + '.'),
    eq('2026K0002', f.kupniNo || '2026K0002'),
    eq('Ostrov nad Ohří, Jáchymovská 1460, 363 01', loc),
    eq('[jméno / obchodní firma]', buyer.name || '[jméno / obchodní firma]'),
  ];
  files.push({ name: 'Najemni_smlouva_' + (f.buyerSlug || '') + '_' + (f.najemniNo || '') + '.docx', buffer: fillDocxFile(path.join(TPL_DIR, 'najemni.docx'), najemniRules) });

  // ── PŘÍLOHA 1 (technická) — jen číslo smlouvy ──
  files.push({ name: 'Priloha_1_Technicka_specifikace_' + (f.kupniNo || '') + '.docx', buffer: fillDocxFile(path.join(TPL_DIR, 'priloha1.docx'), [eq('ke smlouvě: 2026K0002', 'ke smlouvě: ' + (f.kupniNo || ''))]) });

  // ── PŘÍLOHA 2 (předávací protokol) — číslo, strany, lokalita (dat. instalace zůstává [●]) ──
  const p2 = [
    eq('ke smlouvě: 2026K0002', 'ke smlouvě: ' + (f.kupniNo || '')),
    eq('Best Series s.r.o., IČO: [●]', seller.name + ', IČO: ' + (seller.ico || '[●]')),
    eq('[jméno / obchodní firma, IČO / datum narození: ●]', (buyer.name || '[jméno / obchodní firma]') + ', IČO / datum narození: ' + (buyer.ico || '●')),
    eq('Ostrov nad Ohří', locName),
    eq('Jáchymovská 1460, 363 01', f.locationStreet || loc),
    eq('[jméno / obchodní firma]', buyer.name || '[jméno / obchodní firma]'),
  ];
  files.push({ name: 'Priloha_2_Predavaci_protokol_' + (f.kupniNo || '') + '.docx', buffer: fillDocxFile(path.join(TPL_DIR, 'priloha2.docx'), p2) });

  // ── PŘÍLOHA 3 (zavedený provoz + SIS tržby) ──
  const rev = f.rev || {};
  const oldVals = ['62 110 Kč', '40 340 Kč', '54 910 Kč', '43 260 Kč', '44 530 Kč', '33 753 Kč', '37 190 Kč', '41 690 Kč', '40 500 Kč', '48 606 Kč', '37 200 Kč', '72 114 Kč'];
  const oldLabels = ['Červenec 2026', 'Červen 2026', 'Květen 2026', 'Doben 2026', 'Březen 2026', 'Únor 2026', 'Leden 2026', 'Prosinec 2025', 'Listopad 2025', 'Říjen 2025', 'Září 2025', 'Srpen 2025'];
  const p3 = [
    eq('ke smlouvě: 2026K0002', 'ke smlouvě: ' + (f.kupniNo || '')),
    eq('Ostrov nad Ohří', locName),
    eq('Jáchymovská 1460, 363 01', f.locationStreet || loc),
  ];
  if (f.provozStart) p3.push(eq('30.8.2021', f.provozStart));
  if (f.provozDays != null) p3.push(eq('823', String(f.provozDays)));
  if (f.periodLabel) p3.push(eq('Srpen 2025 – červenec 2025', f.periodLabel));
  if (rev.total12 != null) p3.push(eq('556 203 Kč', kc(rev.total12)));
  if (rev.avg != null) p3.push(eq('46 350 Kč', kc(rev.avg)));
  if (rev.rentMonthly != null) p3.push(eq('5 000Kč', kc(rev.rentMonthly)));
  const months = rev.months || [];
  for (let i = 0; i < 12; i++) {
    if (months[i]) {
      if (months[i].label) p3.push(eq(oldLabels[i], months[i].label));
      if (months[i].value != null) p3.push(eq(oldVals[i], kc(months[i].value)));
    }
  }
  // Oprava překlepu i bez dat.
  p3.push(eq('Doben 2026', 'Duben 2026'));
  files.push({ name: 'Priloha_3_Zavedeny_provoz_' + (f.kupniNo || '') + '.docx', buffer: fillDocxFile(path.join(TPL_DIR, 'priloha3.docx'), p3) });

  return files;
}

// Zabalí soubory do jednoho ZIP bufferu.
function zipFiles(files) {
  const zip = new PizZip();
  files.forEach((f) => zip.file(f.name, f.buffer));
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { fillContracts, zipFiles };
