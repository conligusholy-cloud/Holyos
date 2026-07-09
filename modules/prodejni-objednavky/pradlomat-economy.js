// HolyOS — Obchodní pomůcka "Ekonomika prádlomatu"
// Editovatelný TCO / návratnostní model pro jeden prádlomat.
// Verze 1 — odvozeno z Excelu "Ekonomika prádlomatu EURO v cz.xlsx"
//
// Konvence: žluté pole = editovatelný vstup (jako v původním Excelu),
//           ostatní hodnoty = computed (formule v Excelu, read-only).
//
// Použití:
//   <div id="pradlomat-tool-root"></div>
//   <script src="modules/prodejni-objednavky/pradlomat-economy.js"></script>
//   window.PradlomatTool.mount(document.getElementById('pradlomat-tool-root'));

(function (global) {
  'use strict';

  // ─────────────────────────────────────────────────────────────────
  // 0) i18n helper — fallback na český klíč pokud window.PradlomatI18n
  //    není načten (např. v admin UI v Prodejních objednávkách).
  // ─────────────────────────────────────────────────────────────────
  function _t(s) {
    var i = global.PradlomatI18n;
    return (i && typeof i.t === 'function') ? i.t(s) : s;
  }
  function _loc() {
    var i = global.PradlomatI18n;
    return (i && typeof i.locale === 'function') ? i.locale() : 'cs-CZ';
  }

  // ─────────────────────────────────────────────────────────────────
  // 1) Výchozí vstupy (přesně podle Excelu, hardcoded žlutá pole)
  // ─────────────────────────────────────────────────────────────────
  var DEFAULTS = {
    // Investiční náklady (Sheet1: C5-C7)
    cena_pradlomatu: 47000,
    cena_projekt: 825,
    cena_pripojek: 2889,

    // Tržby (Sheet1: C11)
    obrat_na_zakaznika: 11.33,

    // Modelace (Sheet1: C16)
    zakazniku_za_den: 2,

    // Měsíční provozní (Sheet1: C24-C29, C31)
    udrzba: 83,
    software: 62,
    internet: 12,
    infolinka: 21,
    pojisteni: 12,
    najem: 165,
    servis: 62,

    // Energie (Source: G14-G16)
    cena_elektriny: 0.198,
    cena_vodne: 2.629,
    cena_stocne: 2.526,

    // DPH (Source: H19)
    dph: 0.21,

    // Cena služeb s DPH (Source: G20-G25)
    cena_mala_pracka: 8.254,
    cena_mala_pracka_aviv: 9.492,
    cena_velka_pracka: 12.381,
    cena_velka_pracka_aviv: 14.444,
    cena_susicka_15: 2.063,
    cena_cistici_program: 0.825,

    // Detergenty (Source: G28-G29)
    cena_prasku: 2.348,
    cena_avivaze: 1.662,

    // Velká pračka spotřeba na cyklus (Source: G32-G35)
    voda_velka: 160,
    el_velka: 1.05,
    prasek_velka: 0.09,
    aviv_velka: 0.03,

    // Malá pračka spotřeba na cyklus (Source: G41-G44)
    voda_mala: 60,
    el_mala: 0.53,
    prasek_mala: 0.04,
    aviv_mala: 0.02,

    // Sušička spotřeba (Source: G50, G52) — 30 min se počítá jako 2×15min
    susicka_15: 1.8,
    susicka_45: 5.4,

    // 10letý plán rozvoje — kolik nových prádlomatů zákazník uvede do provozu v daném roce
    new_machines_y1: 1,
    new_machines_y2: 1,
    new_machines_y3: 1,
    new_machines_y4: 1,
    new_machines_y5: 1,
    new_machines_y6: 1,
    new_machines_y7: 1,
    new_machines_y8: 1,
    new_machines_y9: 1,
    new_machines_y10: 1
  };

  // ── Měna zobrazení (model je bázově v EUR; přepínač přepočítá stav i symbol) ──
  var CUR = { code: 'EUR', sym: '€' };
  // Peněžní pole (převádějí se při změně měny). Spotřeby (voda/el/prášek/aviváž),
  // počty (zákazníci, stroje) a % (DPH) NEJSOU peníze → nepřevádět.
  var CURRENCY_KEYS = [
    'cena_pradlomatu', 'cena_projekt', 'cena_pripojek', 'obrat_na_zakaznika',
    'udrzba', 'software', 'internet', 'infolinka', 'pojisteni', 'najem', 'servis',
    'cena_elektriny', 'cena_vodne', 'cena_stocne',
    'cena_mala_pracka', 'cena_mala_pracka_aviv', 'cena_velka_pracka', 'cena_velka_pracka_aviv',
    'cena_susicka_15', 'cena_cistici_program', 'cena_prasku', 'cena_avivaze'
  ];
  // Nahradí symbol '€' v jednotce aktuální měnou (např. '€/měs' → 'Kč/měs').
  function curUnit(u) { return (u == null ? '' : String(u)).replace('€', CUR.sym); }

  // ─────────────────────────────────────────────────────────────────
  // 2) Výpočetní engine (přepis všech 40 formulí z Excelu)
  // ─────────────────────────────────────────────────────────────────
  function compute(i) {
    var r = {};

    // Source data — energie (E14-E16 = G mirror)
    r.e_elektriny = i.cena_elektriny;
    r.e_vodne = i.cena_vodne;
    r.e_stocne = i.cena_stocne;

    // Source data — cena služeb bez DPH (E20-E25)
    var dphMul = 1 + i.dph;
    r.bez_mala = i.cena_mala_pracka / dphMul;
    r.bez_mala_aviv = i.cena_mala_pracka_aviv / dphMul;
    r.bez_velka = i.cena_velka_pracka / dphMul;
    r.bez_velka_aviv = i.cena_velka_pracka_aviv / dphMul;
    r.bez_susicka_15 = i.cena_susicka_15 / dphMul;
    r.bez_cistici = i.cena_cistici_program / dphMul;

    // Velká pračka — náklad na cyklus (E32-E35, E37-E39)
    r.naklad_voda_velka = (i.voda_velka / 1000) * (r.e_vodne + r.e_stocne);
    r.naklad_el_velka = i.el_velka * r.e_elektriny;
    r.naklad_prasek_velka = i.prasek_velka * i.cena_prasku;
    r.naklad_aviv_velka = i.aviv_velka * i.cena_avivaze;
    r.naklad_velka_bez_aviv = r.naklad_voda_velka + r.naklad_el_velka + r.naklad_prasek_velka;
    r.naklad_velka_s_aviv = r.naklad_velka_bez_aviv + r.naklad_aviv_velka;
    r.naklad_velka_prumer = (r.naklad_velka_bez_aviv + r.naklad_velka_s_aviv) / 2;

    // Malá pračka — náklad na cyklus (E41-E44, E46-E48)
    r.naklad_voda_mala = (i.voda_mala / 1000) * (r.e_vodne + r.e_stocne);
    r.naklad_el_mala = i.el_mala * r.e_elektriny;
    r.naklad_prasek_mala = i.prasek_mala * i.cena_prasku;
    r.naklad_aviv_mala = i.aviv_mala * i.cena_avivaze;
    r.naklad_mala_bez_aviv = r.naklad_voda_mala + r.naklad_el_mala + r.naklad_prasek_mala;
    r.naklad_mala_s_aviv = r.naklad_mala_bez_aviv + r.naklad_aviv_mala;
    r.naklad_mala_prumer = (r.naklad_mala_bez_aviv + r.naklad_mala_s_aviv) / 2;

    // Sušička (E50-E52, G51 = G50*2)
    r.susicka_30 = i.susicka_15 * 2;
    r.naklad_susicka_15 = i.susicka_15 * r.e_elektriny;
    r.naklad_susicka_30 = r.susicka_30 * r.e_elektriny;
    r.naklad_susicka_45 = i.susicka_45 * r.e_elektriny;

    // Souhrny (E5, E6, E8) — průměrný náklad na zákazníka
    r.prumer_prani = (r.naklad_velka_prumer + r.naklad_mala_prumer) / 2;
    r.prumer_suseni = (r.naklad_susicka_30 + r.naklad_susicka_15) / 2;
    r.naklad_na_zakaznika = r.prumer_prani + r.prumer_suseni; // <- spočtená hodnota (nahrazuje C12)

    // Sheet 1 — investice (C9)
    r.investice_celkem = i.cena_pradlomatu + i.cena_projekt + i.cena_pripojek;

    // Sheet 1 — modelace (C18, C19, C21, C22)
    r.zakazniku_mesic = i.zakazniku_za_den * 30.5;
    r.obrat_den = i.zakazniku_za_den * i.obrat_na_zakaznika;
    r.obrat_mesic = r.zakazniku_mesic * i.obrat_na_zakaznika;
    r.naklad_pracich_cyklu_mesic = r.zakazniku_mesic * r.naklad_na_zakaznika;

    // Měsíční fixní náklady — souhrn (vč. servisu, podle dohody)
    r.fixni_mesic = i.udrzba + i.software + i.internet + i.infolinka + i.pojisteni + i.najem + i.servis;

    // Zisk (C33 + servis, opraveno)
    r.zisk = r.obrat_mesic - r.naklad_pracich_cyklu_mesic - r.fixni_mesic;

    // Návratnost (C35)
    r.navratnost_mesicu = r.zisk > 0 ? r.investice_celkem / r.zisk : Infinity;
    r.navratnost_roku = r.navratnost_mesicu / 12;

    // ── 10letý plán rozvoje ──
    // Každý rok zákazník přidá X nových prádlomatů. Každý generuje stejný měsíční
    // zisk jako jeden v "Modelace" sekci (zisk_per_stroj = r.zisk).
    // Investice = nový stroj × r.investice_celkem (jednorázově v daném roce).
    // Roční provozní zisk = aktuální stav strojů × 12 × r.zisk.
    var ziskPerStrojMesicne = r.zisk;
    var investicePerStroj = r.investice_celkem;
    var stock = 0;
    var cumulative = 0;
    var firstBreakevenYear = null;
    r.projection = [];
    for (var yr = 1; yr <= 10; yr++) {
      var newMachines = Math.max(0, Math.floor(Number(i['new_machines_y' + yr]) || 0));
      stock += newMachines;
      var annualInvestment = newMachines * investicePerStroj;
      var annualOperatingProfit = stock * 12 * ziskPerStrojMesicne;
      var netCashflow = annualOperatingProfit - annualInvestment;
      cumulative += netCashflow;
      if (firstBreakevenYear == null && cumulative >= 0 && (annualInvestment > 0 || yr === 1)) {
        firstBreakevenYear = yr;
      }
      r.projection.push({
        year: yr,
        new_machines: newMachines,
        stock: stock,
        annual_investment: annualInvestment,
        annual_operating_profit: annualOperatingProfit,
        net_cashflow: netCashflow,
        cumulative_cashflow: cumulative
      });
    }
    r.total_stock_10y = stock;
    r.total_cumulative_10y = cumulative;
    r.total_annual_profit_10y = stock * 12 * ziskPerStrojMesicne; // v 10. roce
    r.breakeven_year = firstBreakevenYear;

    return r;
  }

  // ─────────────────────────────────────────────────────────────────
  // 3) Formátování
  // ─────────────────────────────────────────────────────────────────
  function fmtEur(n, decimals) {
    if (!isFinite(n)) return '∞';
    var d = decimals == null ? 0 : decimals;
    return n.toLocaleString(_loc(), { minimumFractionDigits: d, maximumFractionDigits: d }) + ' ' + CUR.sym;
  }
  function fmtNum(n, decimals) {
    if (!isFinite(n)) return '∞';
    var d = decimals == null ? 1 : decimals;
    return n.toLocaleString(_loc(), { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  // ─────────────────────────────────────────────────────────────────
  // 4) Styly (injected jednou)
  // ─────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('pradlomat-tool-styles')) return;
    var s = document.createElement('style');
    s.id = 'pradlomat-tool-styles';
    s.textContent =
      '.pe-grid { display: grid; gap: 14px; }' +
      '.pe-section { background: var(--bg); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }' +
      '.pe-section-head { padding: 12px 16px; background: var(--surface2); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; }' +
      '.pe-section-head .pe-h-icon { font-size: 18px; }' +
      '.pe-section-head h3 { font-size: 13px; font-weight: 700; margin: 0; letter-spacing: 0.3px; }' +
      '.pe-section-head .pe-h-tag { margin-left: auto; font-size: 10px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: #9ca3af; }' +
      '.pe-section-body { padding: 14px 16px; display: grid; gap: 10px; }' +
      '.pe-collapsed .pe-section-body { display: none; }' +
      // Tracky používáme minmax(0,X) aby intrinsic šířka inputu nezpůsobila overflow celé sekce.
      '.pe-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 130px) 70px; gap: 10px; align-items: center; font-size: 13px; }' +
      '.pe-row.lockable { grid-template-columns: minmax(0, 1fr) minmax(0, 130px) 50px 34px; }' +
      '.pe-row.compact { grid-template-columns: minmax(0, 1fr) minmax(0, 130px); }' +
      '.pe-row label { color: var(--text); }' +
      '.pe-row .pe-unit { font-size: 11px; color: var(--text2); text-align: left; }' +
      // CRITICAL FIX: input má intrinsic min-width ~150px → roztahoval grid tracky a přesahoval viewport.
      // min-width:0 + width:100% + box-sizing:border-box ho přinutí respektovat šířku grid buňky.
      '.pe-input { background: #fef3c7; color: #1f2937; border: 1px solid #f59e0b; border-radius: 6px; padding: 6px 10px; font-size: 13px; font-weight: 600; text-align: right; font-family: inherit; min-width: 0; width: 100%; box-sizing: border-box; }' +
      '.pe-input:focus { outline: none; border-color: #f59e0b; box-shadow: 0 0 0 2px rgba(245,158,11,0.3); }' +
      '.pe-input.pe-input-locked { background: #fde68a; border-color: #d97706; border-width: 2px; }' +
      '.pe-lock-btn { background: transparent; border: 1px solid var(--border); border-radius: 6px; width: 30px; height: 30px; cursor: pointer; font-size: 13px; padding: 0; transition: all 0.15s; line-height: 1; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }' +
      '.pe-lock-btn:hover { background: var(--surface2); }' +
      '.pe-lock-btn.locked { background: rgba(217,119,6,0.15); border-color: rgba(217,119,6,0.5); }' +
      '.pe-locked-display { cursor: not-allowed; }' + // dědí .pe-readonly — šedý chip, bílý text, bez zámku
      // 10letý plán rozvoje — VŽDY 5 sloupců × 2 řady. Konzistentní layout od mobilu po 4K.
      '.pe-years-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }' +
      '.pe-year-cell { display: flex; flex-direction: column; align-items: stretch; gap: 4px; min-width: 0; }' +
      '.pe-year-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text2); text-align: center; }' +
      '.pe-year-input { text-align: center !important; padding: 7px 4px !important; font-size: 15px !important; }' +
      // Summary cards — auto-fit s minmax: vejdou se 4 v řadě na widescreenu, 2 v řadě na úzkém, 1 na phone.
      '.pe-projection-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-bottom: 16px; }' +
      '.pe-mini-card { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; min-width: 0; }' +
      '.pe-mini-card .pe-mc-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text2); margin-bottom: 4px; }' +
      '.pe-mini-card .pe-mc-value { font-size: 20px; font-weight: 700; color: #eab308; word-break: break-word; }' +
      '.pe-mini-card.ok .pe-mc-value { color: #10b981; }' +
      '.pe-mini-card.neg .pe-mc-value { color: #ef4444; }' +
      // Chart wrap — žádný horizontální scroll, chart se škáluje přes viewBox SVG. Overflow:hidden jen pro jistotu.
      '.pe-projection-chart-wrap { padding: 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }' +
      '.pe-chart-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; margin-bottom: 12px; }' +
      '.pe-chart-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: var(--text2); }' +
      '.pe-chart-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--text); }' +
      '.pe-leg-item { display: inline-flex; align-items: center; gap: 6px; }' +
      '.pe-leg-item em { color: var(--text2); font-style: normal; font-size: 11px; }' +
      '.pe-leg-sw { width: 14px; height: 10px; border-radius: 2px; flex-shrink: 0; }' +
      '.pe-leg-green { background: linear-gradient(180deg, #34d399, #059669); }' +
      '.pe-leg-line { background: #eab308; height: 3px; border-radius: 2px; }' +
      // SVG se škáluje přes viewBox (1000×360). aspect-ratio = bezpečný fallback pro Safari (height:auto na SVG má bugy).
      // Žádný min-width: chart se VŽDY vejde do svého kontejneru, na malých telefonech jen je menší.
      '.pe-svg { width: 100%; height: auto; display: block; font-family: inherit; aspect-ratio: 1000 / 360; max-height: 460px; }' +
      // Swipe hint — defaultně skrytý, na úzkých displejích se ukáže
      '.pe-chart-swipe-hint { display: none; text-align: center; font-size: 10px; color: var(--text2); margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border); }' +
      // SVG text velikosti — pevné (CSS screen pixels, ne viewBox units)
      '.pe-svg .pe-y-left text, .pe-svg .pe-y-right text { font-size: 13px; }' +
      '.pe-svg .pe-y-left text { fill: #34d399; font-weight: 600; }' +
      '.pe-svg .pe-y-right text { fill: #eab308; font-weight: 600; }' +
      // Outline-stroke pattern — text se čte i přes bary/linku
      '.pe-svg .pe-bar-label { font-size: 12px; font-weight: 700; fill: #34d399; paint-order: stroke; stroke: #0f0f10; stroke-width: 3px; stroke-linejoin: round; }' +
      '.pe-svg .pe-cum-label { font-size: 12px; font-weight: 700; fill: #eab308; paint-order: stroke; stroke: #0f0f10; stroke-width: 3px; stroke-linejoin: round; }' +
      '.pe-svg .pe-x-axis .pe-x-year { font-size: 13px; font-weight: 700; fill: #e5e7eb; }' +
      '.pe-svg .pe-x-axis .pe-x-sub { font-size: 11px; fill: #9ca3af; }' +
      '.pe-svg .pe-legend text { font-size: 13px; fill: #e5e7eb; }' +
      // Tablet/phone — kompaktnější textové prvky, SVG text se přepne na user-units pro lepší škálování.
      // Žádné horizontální scrolly: vše se škáluje do dostupného místa.
      '@media (max-width: 720px) {' +
        '.pe-projection-chart-wrap { padding: 12px 10px; }' +
        '.pe-mini-card { padding: 10px 12px; }' +
        '.pe-mini-card .pe-mc-value { font-size: 17px; }' +
        '.pe-mini-card .pe-mc-label { font-size: 9px; }' +
        '.pe-chart-legend em { display: none; }' +
        '.pe-chart-head { gap: 4px 10px; }' +
        '.pe-chart-title { font-size: 10px; }' +
        '.pe-chart-legend { font-size: 11px; gap: 4px 10px; }' +
        '.pe-year-input { font-size: 14px !important; padding: 6px 3px !important; }' +
        '.pe-year-label { font-size: 9px; }' +
        '.pe-years-grid { gap: 6px; }' +
        // SVG text — na malých displejích kompenzace přes viewBox scale (text se jinak zmenšuje s chartem)
        '.pe-svg .pe-y-left text, .pe-svg .pe-y-right text { font-size: 18px; }' +
        '.pe-svg .pe-bar-label, .pe-svg .pe-cum-label { font-size: 17px; }' +
        '.pe-svg .pe-x-axis .pe-x-year { font-size: 18px; }' +
        '.pe-svg .pe-x-axis .pe-x-sub { font-size: 14px; }' +
      '}' +
      // Phone — extra compact pro malé displeje. Year grid stále 5 cols, ale extra těsná mezera.
      '@media (max-width: 480px) {' +
        '.pe-years-grid { gap: 4px; }' +
        '.pe-year-input { padding: 5px 2px !important; font-size: 13px !important; }' +
        '.pe-mini-card .pe-mc-value { font-size: 15px; }' +
        // Chart text ještě o něco větší vůči user-units (chart je vizuálně velmi malý)
        '.pe-svg .pe-y-left text, .pe-svg .pe-y-right text { font-size: 22px; }' +
        '.pe-svg .pe-bar-label, .pe-svg .pe-cum-label { font-size: 20px; }' +
        '.pe-svg .pe-x-axis .pe-x-year { font-size: 22px; }' +
        '.pe-svg .pe-x-axis .pe-x-sub { font-size: 17px; }' +
      '}' +
      // Stejné fix jako .pe-input: readonly chip musí respektovat šířku grid buňky.
      '.pe-readonly { background: var(--surface2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 13px; font-weight: 600; text-align: right; min-width: 0; width: 100%; box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }' +
      '.pe-readonly.emp { background: rgba(234,179,8,0.10); color: #eab308; border-color: rgba(234,179,8,0.35); }' +
      '.pe-results { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; padding: 18px; background: linear-gradient(135deg, rgba(234,179,8,0.06), rgba(234,179,8,0.02)); border: 1px solid rgba(234,179,8,0.3); border-radius: 12px; }' +
      '.pe-result-card { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 14px; }' +
      '.pe-result-card .pe-rc-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: var(--text2); margin-bottom: 6px; }' +
      '.pe-result-card .pe-rc-value { font-size: 22px; font-weight: 700; color: #eab308; }' +
      '.pe-result-card.neg .pe-rc-value { color: #ef4444; }' +
      '.pe-result-card.ok .pe-rc-value { color: #10b981; }' +
      '.pe-result-card .pe-rc-sub { font-size: 11px; color: var(--text2); margin-top: 4px; }' +
      '.pe-toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 12px 16px; background: var(--surface2); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 14px; }' +
      '.pe-toolbar .pe-legend { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text2); }' +
      '.pe-toolbar .pe-legend .pe-sw { width: 14px; height: 14px; border-radius: 3px; border: 1px solid #f59e0b; background: #fef3c7; }' +
      '.pe-toolbar .pe-legend .pe-sw.ro { background: var(--surface2); border-color: var(--border); }' +
      '.pe-bar-wrap { padding: 16px; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; margin-top: 12px; }' +
      '.pe-bar-row { display: grid; grid-template-columns: 140px 1fr 120px; gap: 10px; align-items: center; font-size: 12px; margin-bottom: 8px; }' +
      '.pe-bar-row .pe-bar { height: 18px; border-radius: 4px; background: var(--surface2); position: relative; overflow: hidden; }' +
      '.pe-bar-row .pe-bar > span { display: block; height: 100%; transition: width 0.2s; }' +
      '.pe-bar-row .pe-bar-val { text-align: right; font-weight: 600; }' +
      '.pe-warn { padding: 10px 12px; background: rgba(239,68,68,0.10); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; color: #ef4444; font-size: 12px; margin-top: 10px; }' +
      '.pe-info { padding: 10px 12px; background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.3); border-radius: 8px; color: #a5b4fc; font-size: 12px; line-height: 1.5; margin-top: 10px; }';
    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────────────────────────
  // 5) Šablona řádku
  // ─────────────────────────────────────────────────────────────────
  function inputRow(label, key, unit, step, decimals) {
    var st = step != null ? step : 1;
    var dec = decimals != null ? decimals : 2;
    var locked = !!LOCKS[key];

    // Zákazník + uzamčené pole → vypadá stejně jako computed (šedý chip, bílý text, bez zámku)
    var inputCell;
    if (ENFORCE_LOCKS && locked) {
      // Inline aktuální hodnotu (bindInputs readonly chipy neřeší)
      var displayVal = formatInputValue(STATE[key], dec);
      inputCell = '<div class="pe-readonly pe-locked-display" data-key="' + key + '">' + displayVal + '</div>';
    } else {
      inputCell = '<input type="number" class="pe-input' + (locked && LOCKABLE ? ' pe-input-locked' : '') +
        '" id="pe-' + key + '" data-key="' + key + '" step="' + st + '" data-decimals="' + dec + '">';
    }

    // Admin režim: lock toggle vpravo (po unit labelu)
    var lockCell = '';
    if (LOCKABLE) {
      lockCell = '<button type="button" class="pe-lock-btn' + (locked ? ' locked' : '') +
        '" data-lock-key="' + key + '" onclick="window.PradlomatTool._toggleLock(\'' + key + '\')" title="' +
        (locked ? _t('Zamčeno — zákazník nesmí měnit. Klik pro odemčení.') : _t('Odemčené — zákazník může měnit. Klik pro zamčení.')) +
        '">' + (locked ? '🔒' : '🔓') + '</button>';
    }

    return (
      '<div class="pe-row' + (LOCKABLE ? ' lockable' : '') + (locked ? ' is-locked' : '') + '">' +
        '<label for="pe-' + key + '">' + label + '</label>' +
        inputCell +
        '<span class="pe-unit">' + curUnit(unit) + '</span>' +
        lockCell +
      '</div>'
    );
  }
  function outRow(label, key, unit, emp) {
    var cls = 'pe-readonly' + (emp ? ' emp' : '');
    // V lockable modu doplň 4. (prázdnou) cell, ať se units zarovnávají s input řádky.
    var spacer = LOCKABLE ? '<span></span>' : '';
    return (
      '<div class="pe-row' + (LOCKABLE ? ' lockable' : '') + '">' +
        '<label>' + label + '</label>' +
        '<div class="' + cls + '" id="pe-out-' + key + '">—</div>' +
        '<span class="pe-unit">' + curUnit(unit) + '</span>' +
        spacer +
      '</div>'
    );
  }
  function section(id, icon, title, tag, bodyHtml, collapsed) {
    return (
      '<div class="pe-section' + (collapsed ? ' pe-collapsed' : '') + '" data-section="' + id + '">' +
        '<div class="pe-section-head" onclick="window.PradlomatTool._toggleSection(this)">' +
          '<span class="pe-h-icon">' + icon + '</span>' +
          '<h3>' + title + '</h3>' +
          (tag ? '<span class="pe-h-tag">' + tag + '</span>' : '') +
          '<span style="font-size:14px;color:var(--text2);">▾</span>' +
        '</div>' +
        '<div class="pe-section-body">' + bodyHtml + '</div>' +
      '</div>'
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // 6) Render
  // ─────────────────────────────────────────────────────────────────
  function buildHTML() {
    var html = '';

    // Toolbar
    var saveDefaultsBtn = ON_SAVE_DEFAULTS
      ? '<button class="btn btn-primary btn-sm" onclick="window.PradlomatTool._saveAsDefaults()">' + _t('💾 Uložit jako výchozí') + '</button>'
      : '';
    html +=
      '<div class="pe-toolbar">' +
        '<span class="pe-legend"><span class="pe-sw"></span> ' + _t('Editovatelné') + '</span>' +
        '<span class="pe-legend"><span class="pe-sw ro"></span> ' + _t('Vypočítané') + '</span>' +
        '<div style="flex:1"></div>' +
        saveDefaultsBtn +
        '<button class="btn btn-secondary btn-sm" onclick="window.PradlomatTool.resetDefaults()">' + _t('↺ Tovární hodnoty') + '</button>' +
        '<button class="btn btn-secondary btn-sm pe-btn-json" onclick="window.PradlomatTool.exportJSON()">' + _t('⬇ Stáhnout model (JSON)') + '</button>' +
      '</div>';

    // Výsledky nahoře (sticky-feel)
    html +=
      '<div class="pe-results" id="pe-results-block">' +
        '<div class="pe-result-card" id="pe-rc-investice"><div class="pe-rc-label">' + _t('Investice celkem') + '</div><div class="pe-rc-value">—</div><div class="pe-rc-sub">' + _t('na jedno místo') + '</div></div>' +
        '<div class="pe-result-card" id="pe-rc-obrat"><div class="pe-rc-label">' + _t('Obrat / měsíc') + '</div><div class="pe-rc-value">—</div><div class="pe-rc-sub" id="pe-rc-obrat-sub">—' + _t(' zákazníků / měs') + '</div></div>' +
        '<div class="pe-result-card" id="pe-rc-zisk"><div class="pe-rc-label">' + _t('Zisk / měsíc') + '</div><div class="pe-rc-value">—</div><div class="pe-rc-sub">' + _t('po všech nákladech vč. servisu') + '</div></div>' +
        '<div class="pe-result-card" id="pe-rc-navratnost"><div class="pe-rc-label">' + _t('Návratnost') + '</div><div class="pe-rc-value">—</div><div class="pe-rc-sub" id="pe-rc-navratnost-sub">—' + _t(' měsíců') + '</div></div>' +
      '</div>';

    // Sekce: Investiční náklady
    var s1 =
      inputRow(_t('Cena prádlomatu'), 'cena_pradlomatu', '€', 100, 0) +
      inputRow(_t('Ø cena projekt + povolení'), 'cena_projekt', '€', 10, 0) +
      inputRow(_t('Ø cena přípojek'), 'cena_pripojek', '€', 10, 0) +
      outRow(_t('Investice celkem'), 'investice_celkem', '€', true);
    html += section('investice', '🏗️', _t('Investiční náklady'), _t('jednorázové'), s1);

    // Sekce: Modelace
    var s2 =
      inputRow(_t('Ø obrat na zákazníka'), 'obrat_na_zakaznika', '€', 0.1, 2) +
      inputRow(_t('Počet zákazníků za den'), 'zakazniku_za_den', _t('ks/den'), 0.1, 1) +
      outRow(_t('Počet zákazníků za měsíc'), 'zakazniku_mesic', _t('ks')) +
      outRow(_t('Obrat / den'), 'obrat_den', '€') +
      outRow(_t('Obrat / měsíc'), 'obrat_mesic', '€', true) +
      outRow(_t('Náklad pracích cyklů / měsíc'), 'naklad_pracich_cyklu_mesic', '€') +
      outRow(_t('Celkem na zákazníka'), 'naklad_na_zakaznika', '€', true);
    html += section('modelace', '📈', _t('Modelace — měsíční'), _t('klíčový vstup'), s2);

    // Sekce: Měsíční fixní náklady
    var s3 =
      inputRow(_t('Pravidelná údržba'), 'udrzba', _t('€/měs'), 1, 0) +
      inputRow(_t('Software'), 'software', _t('€/měs'), 1, 0) +
      inputRow(_t('Internet'), 'internet', _t('€/měs'), 1, 0) +
      inputRow(_t('Infolinka'), 'infolinka', _t('€/měs'), 1, 0) +
      inputRow(_t('Pojištění'), 'pojisteni', _t('€/měs'), 1, 0) +
      inputRow(_t('Nájem'), 'najem', _t('€/měs'), 1, 0) +
      inputRow(_t('Servis'), 'servis', _t('€/měs'), 1, 0) +
      outRow(_t('Fixní náklady celkem'), 'fixni_mesic', _t('€/měs'), true);
    html += section('fixni', '💸', _t('Měsíční fixní náklady'), '', s3);

    // Sekce: Cena energií
    var s4 =
      inputRow(_t('Elektrika'), 'cena_elektriny', _t('€/kWh'), 0.001, 4) +
      inputRow(_t('Vodné'), 'cena_vodne', _t('€/m³'), 0.001, 3) +
      inputRow(_t('Stočné'), 'cena_stocne', _t('€/m³'), 0.001, 3);
    html += section('energie', '⚡', _t('Cena energií'), _t('zdrojová data'), s4, true);

    // Sekce: DPH + ceny služeb (s DPH → bez DPH)
    var s5 =
      inputRow(_t('DPH (sazba)'), 'dph', '%', 0.01, 2) +
      '<div style="margin-top:6px;padding-top:10px;border-top:1px dashed var(--border);">' +
      '<div style="font-size:11px;color:var(--text2);margin-bottom:8px;">' + _t('Cena služeb (vstup s DPH, automaticky bez DPH):') + '</div>' +
      inputRow(_t('Malá pračka'), 'cena_mala_pracka', _t('€ s DPH'), 0.01, 3) +
      outRow(_t('… bez DPH'), 'bez_mala', '€') +
      inputRow(_t('Malá pračka s aviváží'), 'cena_mala_pracka_aviv', _t('€ s DPH'), 0.01, 3) +
      outRow(_t('… bez DPH'), 'bez_mala_aviv', '€') +
      inputRow(_t('Velká pračka'), 'cena_velka_pracka', _t('€ s DPH'), 0.01, 3) +
      outRow(_t('… bez DPH'), 'bez_velka', '€') +
      inputRow(_t('Velká pračka s aviváží'), 'cena_velka_pracka_aviv', _t('€ s DPH'), 0.01, 3) +
      outRow(_t('… bez DPH'), 'bez_velka_aviv', '€') +
      inputRow(_t('Sušička 15 min'), 'cena_susicka_15', _t('€ s DPH'), 0.01, 3) +
      outRow(_t('… bez DPH'), 'bez_susicka_15', '€') +
      inputRow(_t('Čistící program'), 'cena_cistici_program', _t('€ s DPH'), 0.01, 3) +
      outRow(_t('… bez DPH'), 'bez_cistici', '€') +
      '</div>';
    html += section('sluzby', '💰', _t('DPH a cena služeb'), _t('zdrojová data'), s5, true);

    // Sekce: Detergenty
    var s6 =
      inputRow(_t('Cena prášku'), 'cena_prasku', _t('€/l'), 0.01, 3) +
      inputRow(_t('Cena aviváže'), 'cena_avivaze', _t('€/l'), 0.01, 3);
    html += section('detergenty', '🧴', _t('Cena detergentů'), _t('zdrojová data'), s6, true);

    // Sekce: Velká pračka spotřeba
    var s7 =
      inputRow(_t('Voda'), 'voda_velka', _t('l/cyklus'), 1, 0) +
      inputRow(_t('Elektrika'), 'el_velka', _t('kWh/cyklus'), 0.01, 2) +
      inputRow(_t('Prášek'), 'prasek_velka', _t('l/cyklus'), 0.01, 2) +
      inputRow(_t('Aviváž'), 'aviv_velka', _t('l/cyklus'), 0.01, 2) +
      '<div style="margin-top:6px;padding-top:10px;border-top:1px dashed var(--border);font-size:11px;color:var(--text2);margin-bottom:4px;">' + _t('Náklad na cyklus (bez DPH):') + '</div>' +
      outRow(_t('Voda + stočné'), 'naklad_voda_velka', '€') +
      outRow(_t('Elektrika'), 'naklad_el_velka', '€') +
      outRow(_t('Prášek'), 'naklad_prasek_velka', '€') +
      outRow(_t('Aviváž'), 'naklad_aviv_velka', '€') +
      outRow(_t('Bez aviváže celkem'), 'naklad_velka_bez_aviv', '€') +
      outRow(_t('S aviváží celkem'), 'naklad_velka_s_aviv', '€') +
      outRow(_t('Průměr velké pračky'), 'naklad_velka_prumer', '€', true);
    html += section('velka_pracka', '🧺', _t('Velká pračka — spotřeba a náklady'), _t('zdrojová data'), s7, true);

    // Sekce: Malá pračka spotřeba
    var s8 =
      inputRow(_t('Voda'), 'voda_mala', _t('l/cyklus'), 1, 0) +
      inputRow(_t('Elektrika'), 'el_mala', _t('kWh/cyklus'), 0.01, 2) +
      inputRow(_t('Prášek'), 'prasek_mala', _t('l/cyklus'), 0.01, 2) +
      inputRow(_t('Aviváž'), 'aviv_mala', _t('l/cyklus'), 0.01, 2) +
      '<div style="margin-top:6px;padding-top:10px;border-top:1px dashed var(--border);font-size:11px;color:var(--text2);margin-bottom:4px;">' + _t('Náklad na cyklus (bez DPH):') + '</div>' +
      outRow(_t('Voda + stočné'), 'naklad_voda_mala', '€') +
      outRow(_t('Elektrika'), 'naklad_el_mala', '€') +
      outRow(_t('Prášek'), 'naklad_prasek_mala', '€') +
      outRow(_t('Aviváž'), 'naklad_aviv_mala', '€') +
      outRow(_t('Bez aviváže celkem'), 'naklad_mala_bez_aviv', '€') +
      outRow(_t('S aviváží celkem'), 'naklad_mala_s_aviv', '€') +
      outRow(_t('Průměr malé pračky'), 'naklad_mala_prumer', '€', true);
    html += section('mala_pracka', '🧺', _t('Malá pračka — spotřeba a náklady'), _t('zdrojová data'), s8, true);

    // Sekce: Sušička
    var s9 =
      inputRow(_t('Sušička 15 min'), 'susicka_15', 'kWh', 0.1, 1) +
      outRow(_t('Sušička 30 min'), 'susicka_30', 'kWh') +
      inputRow(_t('Sušička 45 min'), 'susicka_45', 'kWh', 0.1, 1) +
      '<div style="margin-top:6px;padding-top:10px;border-top:1px dashed var(--border);font-size:11px;color:var(--text2);margin-bottom:4px;">' + _t('Náklad na sušení:') + '</div>' +
      outRow(_t('15 min'), 'naklad_susicka_15', '€') +
      outRow(_t('30 min'), 'naklad_susicka_30', '€') +
      outRow(_t('45 min'), 'naklad_susicka_45', '€') +
      outRow(_t('Ø praní (velká+malá)'), 'prumer_prani', '€') +
      outRow(_t('Ø sušení (15+30 min)'), 'prumer_suseni', '€') +
      outRow(_t('Celkem na zákazníka'), 'naklad_na_zakaznika', '€', true);
    html += section('susicka', '♨️', _t('Sušička — spotřeba a souhrn nákladů'), _t('zdrojová data'), s9, true);

    // Vizualizace struktury nákladů
    html +=
      '<div class="pe-bar-wrap">' +
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:var(--text2);margin-bottom:10px;">' + _t('Struktura měsíčních toků') + '</div>' +
        '<div id="pe-bars"></div>' +
      '</div>';

    // Sekce: 10letý plán rozvoje — úplně na konci (vrchol "prodejního příběhu")
    html +=
      '<div class="pe-section" data-section="projection" style="margin-top:18px;">' +
        '<div class="pe-section-head" onclick="window.PradlomatTool._toggleSection(this)">' +
          '<span class="pe-h-icon">📈</span>' +
          '<h3>' + _t('10letý plán rozvoje') + '</h3>' +
          '<span class="pe-h-tag">' + _t('vlastní síť prádlomatů') + '</span>' +
          '<span style="font-size:14px;color:var(--text2);">▾</span>' +
        '</div>' +
        '<div class="pe-section-body">' +
          '<div style="font-size:12px;color:var(--text2);line-height:1.5;margin-bottom:10px;">' +
            _t('Kolik nových prádlomatů uvedete do provozu v každém roce? Pomůcka spočítá kumulativní zisk pro celou rostoucí síť.') +
          '</div>' +
          '<div class="pe-years-grid" id="pe-years-grid">' + buildYearsGrid() + '</div>' +
          '<div class="pe-projection-summary" id="pe-projection-summary"></div>' +
          '<div class="pe-projection-chart-wrap">' +
            '<div class="pe-chart-head">' +
              '<div class="pe-chart-title">' + _t('Roční zisk a kumulativní cashflow (10 let)') + '</div>' +
              '<div class="pe-chart-legend">' +
                '<span class="pe-leg-item"><span class="pe-leg-sw pe-leg-green"></span><span>' + _t('Roční provozní zisk') + ' <em>' + _t('(levá osa)') + '</em></span></span>' +
                '<span class="pe-leg-item"><span class="pe-leg-sw pe-leg-line"></span><span>' + _t('Kumulativní cashflow') + ' <em>' + _t('(pravá osa)') + '</em></span></span>' +
              '</div>' +
            '</div>' +
            '<div id="pe-projection-chart"></div>' +
            '<div class="pe-chart-swipe-hint">' + _t('← Tažením doleva zobrazíte další roky →') + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    return html;
  }

  // ─────────────────────────────────────────────────────────────────
  // 7) Bind + recalc
  // ─────────────────────────────────────────────────────────────────
  var STATE = Object.assign({}, DEFAULTS);
  var LOCKS = {}; // { field_key: true } — pole, která zákazník nemůže měnit
  var ROOT = null;
  var ON_CHANGE = null;
  var ON_SAVE_DEFAULTS = null; // callback(state, locks) → Promise; render tlačítka "Uložit jako výchozí"
  var LOCKABLE = false;        // admin režim: vedle žlutých inputů se renderuje lock toggle
  var ENFORCE_LOCKS = false;   // zákaznický režim: zamčené žluté inputy jsou read-only

  function bindInputs() {
    var inputs = ROOT.querySelectorAll('.pe-input');
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      var key = inp.getAttribute('data-key');
      inp.value = formatInputValue(STATE[key], inp.getAttribute('data-decimals'));
      inp.addEventListener('input', onInputChange);
      inp.addEventListener('change', onInputChange);
    }
    recalcAndRender();
  }

  function formatInputValue(v, decimals) {
    if (v == null || isNaN(v)) return '';
    var d = parseInt(decimals, 10) || 0;
    // Pro celá čísla: zachovat tak, jak jsou — žádné stripování trailing nul
    // (160 musí zůstat "160", ne "16"; 47000 ne "47").
    if (d === 0) return String(Math.round(Number(v)));
    // Pro desetinná: toFixed(d), pak odstranit jen trailing nuly ZA desetinnou čárkou.
    // "11.33" zůstane "11.33", "1.50" → "1.5", "1.00" → "1".
    var s = Number(v).toFixed(d);
    if (s.indexOf('.') >= 0) {
      s = s.replace(/0+$/, '').replace(/\.$/, '');
    }
    return s;
  }

  function onInputChange(e) {
    var key = e.target.getAttribute('data-key');
    var v = parseFloat(e.target.value.replace(',', '.'));
    if (isNaN(v)) v = 0;
    STATE[key] = v;
    recalcAndRender();
    if (typeof ON_CHANGE === 'function') {
      try { ON_CHANGE(STATE, lastResult); } catch (e2) { /* noop */ }
    }
  }

  var lastResult = null;

  function recalcAndRender() {
    var r = compute(STATE);
    lastResult = r;

    // Naplnění read-only buněk
    var fields = [
      ['investice_celkem', 0], ['zakazniku_mesic', 0], ['obrat_den', 2], ['obrat_mesic', 2],
      ['naklad_pracich_cyklu_mesic', 2], ['naklad_na_zakaznika', 4], ['fixni_mesic', 0],
      ['e_elektriny', 4], ['e_vodne', 3], ['e_stocne', 3],
      ['bez_mala', 3], ['bez_mala_aviv', 3], ['bez_velka', 3], ['bez_velka_aviv', 3],
      ['bez_susicka_15', 3], ['bez_cistici', 3],
      ['naklad_voda_velka', 3], ['naklad_el_velka', 3], ['naklad_prasek_velka', 3], ['naklad_aviv_velka', 3],
      ['naklad_velka_bez_aviv', 3], ['naklad_velka_s_aviv', 3], ['naklad_velka_prumer', 3],
      ['naklad_voda_mala', 3], ['naklad_el_mala', 3], ['naklad_prasek_mala', 3], ['naklad_aviv_mala', 3],
      ['naklad_mala_bez_aviv', 3], ['naklad_mala_s_aviv', 3], ['naklad_mala_prumer', 3],
      ['susicka_30', 1], ['naklad_susicka_15', 3], ['naklad_susicka_30', 3], ['naklad_susicka_45', 3],
      ['prumer_prani', 3], ['prumer_suseni', 3]
    ];
    for (var i = 0; i < fields.length; i++) {
      // Některé klíče (např. naklad_na_zakaznika) figurují ve více sekcích —
      // querySelectorAll naplní VŠECHNY výskyty, aby se „Celkem na zákazníka"
      // (v sekci Modelace i Sušička) aktualizoval stejnou logikou jako u praček.
      var els = ROOT.querySelectorAll('#pe-out-' + fields[i][0]);
      var v = r[fields[i][0]];
      if (typeof v !== 'number') continue;
      var txt = fmtNum(v, fields[i][1]);
      for (var j = 0; j < els.length; j++) {
        els[j].textContent = txt;
      }
    }

    // Hlavní výsledky
    setResultCard('pe-rc-investice', fmtEur(r.investice_celkem, 0), _t('na jedno místo'));
    setResultCard('pe-rc-obrat', fmtEur(r.obrat_mesic, 0), fmtNum(r.zakazniku_mesic, 0) + _t(' zákazníků / měs'));
    setResultCard('pe-rc-zisk', fmtEur(r.zisk, 0), r.zisk >= 0 ? _t('po všech nákladech vč. servisu') : _t('ZTRÁTOVÝ provoz'), r.zisk < 0 ? 'neg' : 'ok');
    if (isFinite(r.navratnost_mesicu) && r.navratnost_mesicu > 0) {
      setResultCard('pe-rc-navratnost', fmtNum(r.navratnost_roku, 1) + _t(' let'), fmtNum(r.navratnost_mesicu, 0) + _t(' měsíců'));
    } else {
      setResultCard('pe-rc-navratnost', '∞', _t('při této modelaci se neuhradí'), 'neg');
    }

    renderBars(r);
    renderProjectionSummary(r);
    renderProjectionChart(r);
  }

  function setResultCard(id, value, sub, cls) {
    var card = ROOT.querySelector('#' + id);
    if (!card) return;
    card.classList.remove('neg', 'ok');
    if (cls) card.classList.add(cls);
    var v = card.querySelector('.pe-rc-value');
    var s = card.querySelector('.pe-rc-sub');
    if (v) v.textContent = value;
    if (s) s.textContent = sub;
  }

  function renderBars(r) {
    var holder = ROOT.querySelector('#pe-bars');
    if (!holder) return;
    var items = [
      { label: _t('Obrat'), value: r.obrat_mesic, color: '#10b981' },
      { label: _t('Náklad pracích cyklů'), value: r.naklad_pracich_cyklu_mesic, color: '#f97316' },
      { label: _t('Fixní náklady'), value: r.fixni_mesic, color: '#ef4444' },
      { label: _t('Zisk'), value: r.zisk, color: r.zisk >= 0 ? '#eab308' : '#dc2626' }
    ];
    var max = Math.max.apply(null, items.map(function (x) { return Math.abs(x.value); }));
    if (max <= 0) max = 1;
    var html = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var pct = Math.max(0, Math.abs(it.value) / max * 100);
      html +=
        '<div class="pe-bar-row">' +
          '<div>' + it.label + '</div>' +
          '<div class="pe-bar"><span style="width:' + pct.toFixed(1) + '%;background:' + it.color + ';"></span></div>' +
          '<div class="pe-bar-val" style="color:' + it.color + ';">' + fmtEur(it.value, 0) + '</div>' +
        '</div>';
    }
    holder.innerHTML = html;
  }

  // ─── 10letá projekce ────────────────────────────────────────────
  function buildYearsGrid() {
    var html = '';
    for (var y = 1; y <= 10; y++) {
      var key = 'new_machines_y' + y;
      var locked = !!LOCKS[key];
      var cell;
      if (ENFORCE_LOCKS && locked) {
        var v = formatInputValue(STATE[key], 0);
        cell = '<div class="pe-readonly pe-locked-display pe-year-input" data-key="' + key + '">' + v + '</div>';
      } else {
        cell = '<input type="number" class="pe-input pe-year-input" id="pe-' + key +
          '" data-key="' + key + '" step="1" data-decimals="0" min="0">';
      }
      var lockBtn = LOCKABLE
        ? '<button type="button" class="pe-lock-btn' + (locked ? ' locked' : '') +
          '" data-lock-key="' + key + '" onclick="window.PradlomatTool._toggleLock(\'' + key + '\')" title="' +
          (locked ? _t('Zamčeno') : _t('Odemčené')) + '">' + (locked ? '🔒' : '🔓') + '</button>'
        : '';
      html +=
        '<div class="pe-year-cell">' +
          '<div class="pe-year-label">' + _t('Rok ') + y + '</div>' +
          cell +
          lockBtn +
        '</div>';
    }
    return html;
  }

  function renderProjectionSummary(r) {
    var el = ROOT.querySelector('#pe-projection-summary');
    if (!el || !r.projection) return;
    var cumCls = r.total_cumulative_10y >= 0 ? 'ok' : 'neg';
    el.innerHTML =
      '<div class="pe-mini-card">' +
        '<div class="pe-mc-label">' + _t('Prádlomatů po 10 letech') + '</div>' +
        '<div class="pe-mc-value">' + r.total_stock_10y + '</div>' +
      '</div>' +
      '<div class="pe-mini-card">' +
        '<div class="pe-mc-label">' + _t('Roční zisk v 10. roce') + '</div>' +
        '<div class="pe-mc-value">' + fmtEur(r.total_annual_profit_10y, 0) + '</div>' +
      '</div>' +
      '<div class="pe-mini-card ' + cumCls + '">' +
        '<div class="pe-mc-label">' + _t('Kumulativní zisk po 10 letech') + '</div>' +
        '<div class="pe-mc-value">' + fmtEur(r.total_cumulative_10y, 0) + '</div>' +
      '</div>';
  }

  function renderProjectionChart(r) {
    var holder = ROOT.querySelector('#pe-projection-chart');
    if (!holder || !r.projection || !r.projection.length) return;
    var data = r.projection;

    // Jednotná viewBox geometrie — legenda + titulek jsou v HTML nad SVG,
    // takže uvnitř SVG nepotřebujeme padding pro ně. CSS škáluje font.
    // 1000×360 (poměr 2.78:1) — kompaktnější vertikálně, lépe se vejde na Mac viewport.
    var W = 1000;
    var H = 360;
    var padL = 64;   // levá Y osa (bary) — užší (krátké labely k/M €)
    var padR = 64;   // pravá Y osa (kumulativní)
    var padT = 26;   // jen dýchání nahoru pro labely bar tops
    var padB = 56;   // X labely (Rok N + extra řádek)
    var innerW = W - padL - padR;
    var innerH = H - padT - padB;
    var bandW = innerW / data.length;
    var barW = bandW * 0.56;

    // ── Dvě nezávislé Y škály ──
    // Levá: roční provozní zisk (bary, vždy >= 0). Yákony: 0 → maxProfit.
    // Pravá: kumulativní cashflow (linie). Y: minCum (i záporné) → maxCum.
    var maxProfit = 0;
    var minCum = 0, maxCum = 0;
    data.forEach(function (d) {
      if (d.annual_operating_profit > maxProfit) maxProfit = d.annual_operating_profit;
      if (d.cumulative_cashflow < minCum) minCum = d.cumulative_cashflow;
      if (d.cumulative_cashflow > maxCum) maxCum = d.cumulative_cashflow;
    });
    if (maxProfit <= 0) maxProfit = 1;
    // K aspektu osy: zaokrouhli max nahoru na pěkné číslo
    function niceMax(v) {
      if (v <= 0) return 1;
      var mag = Math.pow(10, Math.floor(Math.log10(v)));
      var n = v / mag;
      var step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
      return step * mag;
    }
    var leftMax = niceMax(maxProfit);
    var rightMax = niceMax(Math.max(maxCum, 1));
    var rightMin = minCum < 0 ? -niceMax(Math.abs(minCum)) : 0;

    function yLeft(v) { return padT + innerH - (v / leftMax) * innerH; }
    function yRight(v) { return padT + innerH - ((v - rightMin) / (rightMax - rightMin)) * innerH; }
    function xCenter(i) { return padL + i * bandW + bandW / 2; }

    var zeroLeftY = yLeft(0);
    var zeroRightY = yRight(0);

    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="pe-svg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">';

    // Defs (gradient pro bary)
    s += '<defs>' +
      '<linearGradient id="peGradGreen" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#34d399"/>' +
        '<stop offset="100%" stop-color="#059669"/>' +
      '</linearGradient>' +
    '</defs>';

    // Gridlines (5 pásem na levé ose)
    var ticks = 5;
    s += '<g class="pe-grid" stroke="rgba(255,255,255,0.06)" fill="none">';
    for (var t = 0; t <= ticks; t++) {
      var yp = padT + innerH - (t / ticks) * innerH;
      s += '<line x1="' + padL + '" y1="' + yp.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + yp.toFixed(1) + '"/>';
    }
    s += '</g>';

    // Zero line (pokud right Y má záporné hodnoty, ukáže se)
    if (rightMin < 0) {
      s += '<line x1="' + padL + '" y1="' + zeroRightY.toFixed(1) + '" x2="' + (W - padR) +
        '" y2="' + zeroRightY.toFixed(1) + '" stroke="rgba(255,255,255,0.22)" stroke-width="1" stroke-dasharray="4 3"/>';
    }

    // Levá Y osa labely (bary v zelené)
    s += '<g class="pe-y-left">';
    for (var t1 = 0; t1 <= ticks; t1++) {
      var ylv = (leftMax * t1) / ticks;
      var ylp = padT + innerH - (t1 / ticks) * innerH;
      s += '<text x="' + (padL - 8) + '" y="' + (ylp + 4).toFixed(1) + '" text-anchor="end">' + fmtNumShort(ylv) + '</text>';
    }
    s += '</g>';

    // Pravá Y osa labely (linie ve žluté)
    s += '<g class="pe-y-right">';
    for (var t2 = 0; t2 <= ticks; t2++) {
      var yrv = rightMin + (rightMax - rightMin) * (t2 / ticks);
      var yrp = padT + innerH - (t2 / ticks) * innerH;
      s += '<text x="' + (W - padR + 8) + '" y="' + (yrp + 4).toFixed(1) + '" text-anchor="start">' + fmtNumShort(yrv) + '</text>';
    }
    s += '</g>';

    // Bary (roční provozní zisk — vlevo na levou Y škálu)
    s += '<g>';
    data.forEach(function (d, i) {
      var cx = xCenter(i);
      var yTop = yLeft(d.annual_operating_profit);
      var h = Math.max(0, zeroLeftY - yTop);
      s += '<rect x="' + (cx - barW / 2).toFixed(1) + '" y="' + yTop.toFixed(1) +
        '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) +
        '" fill="url(#peGradGreen)" rx="3"/>';
      // Hodnota nad barem (clamp do view aby nepřesahla nahoru)
      if (h > 14) {
        var barLabelY = Math.max(padT + 14, yTop - 6);
        s += '<text class="pe-bar-label" x="' + cx.toFixed(1) + '" y="' + barLabelY.toFixed(1) +
          '" text-anchor="middle">' + fmtNumShort(d.annual_operating_profit) + '</text>';
      }
    });
    s += '</g>';

    // Kumulativní linie (pravá Y škála)
    var pathD = '';
    data.forEach(function (d, i) {
      var x = xCenter(i);
      var y = yRight(d.cumulative_cashflow);
      pathD += (i === 0 ? 'M ' : 'L ') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
    });
    s += '<path d="' + pathD.trim() + '" fill="none" stroke="#eab308" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';

    // Tečky + labely kumulativní linie (chytře umístěné aby se nepřekrývaly s X osou ani bary)
    s += '<g>';
    data.forEach(function (d, i) {
      var x = xCenter(i);
      var y = yRight(d.cumulative_cashflow);
      // Tečka
      s += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) +
        '" r="4" fill="#eab308" stroke="#0f0f10" stroke-width="2"/>';
      // Smart label position: pokud je tečka nízko (do 24px nad X osou), label nad ní s odsazením; jinak nad tečkou
      var labelY;
      var bottomLimit = padT + innerH - 8;
      if (y > bottomLimit - 14) {
        labelY = y - 10; // nad tečkou (dot je dole, label nad)
      } else if (y < padT + 20) {
        labelY = y + 14; // pod tečkou (dot je nahoře, label pod)
      } else {
        labelY = y - 10; // standardně nad
      }
      s += '<text class="pe-cum-label" x="' + x.toFixed(1) + '" y="' + labelY.toFixed(1) +
        '" text-anchor="middle">' + fmtNumShort(d.cumulative_cashflow) + '</text>';
    });
    s += '</g>';

    // X osa labely (Rok N + počet strojů)
    s += '<g class="pe-x-axis">';
    data.forEach(function (d, i) {
      var x = xCenter(i);
      var y1 = padT + innerH + 18;
      var y2 = padT + innerH + 36;
      s += '<text class="pe-x-year" x="' + x.toFixed(1) + '" y="' + y1 + '" text-anchor="middle">' + _t('Rok ') + d.year + '</text>';
      var extra = (d.new_machines > 0
        ? '+' + d.new_machines + (d.new_machines === 1 ? _t(' stroj') : (d.new_machines < 5 ? _t(' stroje') : _t(' strojů')))
        : _t('beze změny'));
      s += '<text class="pe-x-sub" x="' + x.toFixed(1) + '" y="' + y2 + '" text-anchor="middle">' + extra + '</text>';
    });
    s += '</g>';

    s += '</svg>';
    holder.innerHTML = s;
  }

  function fmtNumShort(v) {
    if (!isFinite(v)) return '∞';
    var sign = v < 0 ? '-' : '';
    var a = Math.abs(v);
    if (a >= 1e6) return sign + (a / 1e6).toFixed(1) + ' M €';
    if (a >= 1e3) return sign + (a / 1e3).toFixed(0) + ' k €';
    return sign + a.toFixed(0) + ' ' + CUR.sym;
  }

  // ─────────────────────────────────────────────────────────────────
  // 8) Public API
  // ─────────────────────────────────────────────────────────────────
  function mount(rootEl, options) {
    if (!rootEl) return;
    ROOT = rootEl;
    options = options || {};

    // 1) Nastav VŠECHNY flagy PŘED buildHTML(), ať render zná lockable / locks / state.
    ON_CHANGE = (typeof options.onChange === 'function') ? options.onChange : null;
    ON_SAVE_DEFAULTS = (typeof options.onSaveDefaults === 'function') ? options.onSaveDefaults : null;
    LOCKABLE = !!options.lockable;
    ENFORCE_LOCKS = !!options.enforceLocks;
    LOCKS = (options.locks && typeof options.locks === 'object') ? Object.assign({}, options.locks) : {};

    // 2) Merge initialState do STATE PŘED renderem (ať locked chip ukáže správnou hodnotu).
    if (options.initialState && typeof options.initialState === 'object') {
      for (var k in options.initialState) {
        if (k in STATE) STATE[k] = options.initialState[k];
      }
    }

    // 3) Render.
    injectStyles();
    ROOT.innerHTML = buildHTML();
    bindInputs();
  }

  function _saveAsDefaults() {
    if (typeof ON_SAVE_DEFAULTS !== 'function') return;
    var btn = ROOT && ROOT.querySelector('.pe-toolbar .btn-primary');
    var orig = btn ? btn.innerHTML : null;
    if (btn) { btn.disabled = true; btn.innerHTML = _t('Ukládám…'); }
    var state = Object.assign({}, STATE);
    var locks = Object.assign({}, LOCKS);
    Promise.resolve(ON_SAVE_DEFAULTS(state, locks)).then(function () {
      if (btn) { btn.innerHTML = _t('✓ Uloženo'); setTimeout(function () { if (btn.isConnected) btn.innerHTML = orig; btn.disabled = false; }, 1800); }
    }).catch(function (e) {
      if (btn) { btn.innerHTML = _t('✗ Chyba'); btn.disabled = false; }
      alert(_t('Nepodařilo se uložit výchozí hodnoty: ') + (e && e.message || e));
    });
  }

  function _toggleLock(key) {
    if (!LOCKABLE) return;
    if (LOCKS[key]) {
      delete LOCKS[key];
    } else {
      LOCKS[key] = true;
    }
    var btn = ROOT && ROOT.querySelector('.pe-lock-btn[data-lock-key="' + key + '"]');
    var inp = ROOT && document.getElementById('pe-' + key);
    var row = btn && btn.parentElement;
    if (btn) {
      btn.classList.toggle('locked', !!LOCKS[key]);
      btn.innerHTML = LOCKS[key] ? '🔒' : '🔓';
      btn.title = LOCKS[key]
        ? _t('Zamčeno — zákazník nesmí měnit. Klik pro odemčení.')
        : _t('Odemčené — zákazník může měnit. Klik pro zamčení.');
    }
    if (inp) inp.classList.toggle('pe-input-locked', !!LOCKS[key]);
    if (row) row.classList.toggle('is-locked', !!LOCKS[key]);
  }

  function getLocks() { return Object.assign({}, LOCKS); }

  function resetDefaults() {
    STATE = Object.assign({}, DEFAULTS);
    bindInputs();
  }

  // Přepnutí měny: nastaví symbol a přepočítá peněžní pole stavu poměrem kurzů
  // (ratio = kolik nové měny za 1 jednotku staré). Payback/ROI/% zůstávají (poměry).
  function setCurrency(code, sym, ratio) {
    CUR = { code: code || 'EUR', sym: sym || '€' };
    if (ratio && isFinite(ratio) && ratio !== 1) {
      for (var i = 0; i < CURRENCY_KEYS.length; i++) {
        var k = CURRENCY_KEYS[i];
        if (typeof STATE[k] === 'number' && isFinite(STATE[k])) STATE[k] = STATE[k] * ratio;
      }
    }
    if (ROOT) { ROOT.innerHTML = buildHTML(); bindInputs(); }
  }
  function getCurrency() { return { code: CUR.code, sym: CUR.sym }; }

  function exportJSON() {
    var data = { inputs: STATE, computed: compute(STATE), generated_at: new Date().toISOString(), tool: 'pradlomat-economy', version: 1 };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'ekonomika-pradlomatu-' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 500);
  }

  function _toggleSection(headEl) {
    var sec = headEl.parentElement;
    sec.classList.toggle('pe-collapsed');
  }

  function getState() { return Object.assign({}, STATE); }
  function getComputed() { return compute(STATE); }

  global.PradlomatTool = {
    mount: mount,
    resetDefaults: resetDefaults,
    setCurrency: setCurrency,
    getCurrency: getCurrency,
    exportJSON: exportJSON,
    getState: getState,
    getComputed: getComputed,
    getLocks: getLocks,
    compute: compute,
    DEFAULTS: DEFAULTS,
    _toggleSection: _toggleSection,
    _saveAsDefaults: _saveAsDefaults,
    _toggleLock: _toggleLock
  };
})(window);
