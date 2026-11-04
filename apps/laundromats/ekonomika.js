// Laundromats — výpočet živého modelu ekonomiky (běží v prohlížeči). Model drží hodnoty v EUR, zobrazuje ve zvolené měně.
(function () {
  'use strict';
  var T = window.EKO_T || {};
  var LOC = (document.documentElement.lang === 'pl') ? 'pl-PL' : 'cs-CZ';
  var VARIANTS = {
    V3: { machine: 52000, conn: 2889, spend: 11.33, cost: 767, perday: 8 },
    V2: { machine: 35000, conn: 1926, spend: 16.52, cost: 647, perday: 5 },
    V4: { machine: 67000, conn: 2889, spend: 11.33, cost: 900, perday: 10 } // MAX (náklady i útratu dopočítá společný model)
  };
  var PERMIT = 825;
  var RATES = { CZK: 1, EUR: 24.35, PLN: 1 / 0.1807 }; // CZK za 1 jednotku
  var SYM = { CZK: 'Kč', EUR: '€', PLN: 'zł' };
  var PHOTOS = { V4: '/media/provozovna-3.webp' }; // MAX: vlastní fotka (MINI/FLEX přijdou z HolyOS)
  function photo() { var im = $('ek-photo'); if (im && PHOTOS[VER] && im.getAttribute('src') !== PHOTOS[VER]) im.src = PHOTOS[VER]; }
  var CUR = T.defCur || 'CZK', VER = 'V2'; // výchozí MINI
  var M = { machine: 0, permit: 0, conn: 0, spend: 0, cost: 0, perday: 0, rent: null, spendSet: false }; // v EUR (perday ks); rent/spend zadané zákazníkem
  var $ = function (id) { return document.getElementById(id); };
  var f = function () { return RATES.EUR / RATES[CUR]; }; // EUR → zobrazená měna
  var fmt = function (v, d) { return (Number(v) || 0).toLocaleString(LOC, { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }); };
  var parse = function (s) { var n = parseFloat(String(s).replace(/[\s ]/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };

  function load(v) { var c = VARIANTS[v]; M.machine = c.machine; M.permit = PERMIT; M.conn = c.conn; M.spend = c.spend; M.cost = c.cost; M.perday = c.perday; M.rent = null; M.spendSet = false; }
  function show() {
    var k = f(), S = SYM[CUR];
    $('i-machine').value = fmt(M.machine * k); $('i-permit').value = fmt(M.permit * k); $('i-conn').value = fmt(M.conn * k);
    $('i-spend').value = fmt(M.spend * k, 2); $('i-cost').value = fmt(M.cost * k); $('i-perday').value = String(M.perday);
    [].forEach.call(document.querySelectorAll('.u-cur'), function (e) { e.textContent = S; });
    [].forEach.call(document.querySelectorAll('#ek-ver button'), function (b) { b.classList.toggle('on', b.getAttribute('data-v') === VER); });
    [].forEach.call(document.querySelectorAll('#ek-cur button'), function (b) { b.classList.toggle('on', b.getAttribute('data-c') === CUR); });
    photo(); calc();
  }
  // Stejný výpočet jako „Podrobný přehled ekonomiky" (pradlomat-economy.js = model z Excelu):
  // obrat na zákazníka bez DPH, náklad pracích cyklů roste s počtem zákazníků + měsíční fixní náklady.
  // Bez enginu (nenačetl se) záložní zjednodušený výpočet.
  function engine() {
    var PT = window.PradlomatTool; if (!PT || !PT.compute || !PT.getState) return null;
    try {
      if (PT.getVersion && PT.getVersion() !== VER) PT.setVersion(VER);
      var st = PT.getState(); // v EUR (nástroj není připojený → výchozí měna EUR)
      var inp = { cena_pradlomatu: M.machine, cena_projekt: M.permit, cena_pripojek: M.conn, zakazniku_za_den: M.perday };
      if (M.spendSet) inp.obrat_na_zakaznika = M.spend; if (M.rent != null) inp.najem = M.rent;
      var r = PT.compute(Object.assign({}, st, inp));
      return { spend: M.spendSet ? M.spend : st.obrat_na_zakaznika, rent: M.rent != null ? M.rent : st.najem, revenue: r.obrat_mesic, cost: r.naklad_pracich_cyklu_mesic + r.fixni_mesic, profit: r.zisk };
    } catch (e) { return null; }
  }
  function calc() {
    var k = f(), S = ' ' + SYM[CUR];
    var invest = (M.machine + M.permit + M.conn) * k;
    var custMonth = M.perday * 30.5;
    var E = engine();
    if (E) { M.spend = E.spend; M.cost = E.cost; var es = $('i-spend'), ec = $('i-cost'), er = $('i-rent'); if (es && document.activeElement !== es) es.value = fmt(E.spend * k, 2); if (er && document.activeElement !== er) er.value = fmt(E.rent * k); if (ec) ec.value = fmt(E.cost * k); }
    var revenue = E ? E.revenue * k : custMonth * M.spend * k;
    var profit = E ? E.profit * k : revenue - M.cost * k;
    var pbM = profit > 0 ? invest / profit : 0, pbY = pbM / 12;
    $('o-invest').value = fmt(invest); $('o-profit').value = fmt(profit);
    $('m-invest').textContent = fmt(invest) + S;
    $('m-revenue').textContent = fmt(revenue) + S;
    $('m-cust').textContent = fmt(custMonth) + ' ' + T.custMo;
    $('m-profit').textContent = fmt(profit) + S;
    var pb = profit > 0 ? (fmt(pbY, 1) + ' ' + T.years) : '—';
    var pbm = profit > 0 ? (Math.round(pbM) + ' ' + T.months) : T.loss;
    $('m-payback').textContent = pb; $('m-payback-m').textContent = pbm;
    $('r-payback').textContent = pb; $('r-payback-m').textContent = pbm;
    $('r-yearprofit').textContent = fmt(profit * 12) + S;
    var roi = invest > 0 ? profit * 12 / invest * 100 : 0;
    $('r-roi').textContent = roi > 0 ? (Math.round(roi) + ' %') : '—';
    $('r-5y').textContent = fmt(profit * 60 - invest) + S;
    var pct = pbY > 0 ? Math.min(100, 100 / pbY) : 0;
    $('r-bar').style.width = pct.toFixed(0) + '%';
    $('r-bar-note').textContent = profit > 0 ? String(T.paid).replace('{pct}', pct.toFixed(0)) : T.lossNote;
  }
  function bind(id, key, perCur) {
    var el = $(id);
    el.addEventListener('input', function () { var v = parse(el.value); M[key] = perCur ? v / f() : v; calc(); });
    el.addEventListener('blur', function () { el.value = perCur ? fmt(M[key] * f()) : String(M[key]); });
  }
  // sledování úprav modelu (po dokončení psaní) + otevření stránky
  var LBL = { 'i-machine': 'Cena prádlomatu', 'i-permit': 'Projekt + povolení', 'i-conn': 'Přípojky', 'i-perday': 'Zákazníků / den' };
  Object.keys(LBL).forEach(function (id) { $(id).addEventListener('change', function () { if (window.lmTrack) lmTrack('eco_edit', { key: id, label: LBL[id], value: $(id).value + (id === 'i-perday' ? '' : ' ' + SYM[CUR]) }); }); });
  [].forEach.call(document.querySelectorAll('#ek-ver button'), function (b) { b.addEventListener('click', function () { if (window.lmTrack) lmTrack('eco_edit', { key: 'variant', label: 'Varianta', value: b.textContent }); }); });
  [].forEach.call(document.querySelectorAll('#ek-cur button'), function (b) { b.addEventListener('click', function () { if (window.lmTrack) lmTrack('eco_edit', { key: 'currency', label: 'Měna', value: b.textContent }); }); });
  if (window.lmTrack) lmTrack('eco_open', { view: 'basic' });
  bind('i-machine', 'machine', true); bind('i-permit', 'permit', true); bind('i-conn', 'conn', true); bind('i-perday', 'perday', false);
  // Útrata na zákazníka a nájem si zákazník zadává sám (modelovací kalkulačka)
  (function () { var es = $('i-spend'), er = $('i-rent');
    if (es) { es.addEventListener('input', function () { M.spend = parse(es.value) / f(); M.spendSet = true; calc(); }); es.addEventListener('blur', function () { setTimeout(calc, 0); }); es.addEventListener('change', function () { if (window.lmTrack) lmTrack('eco_edit', { key: 'i-spend', label: 'Ø útrata / zákazník', value: es.value + ' ' + SYM[CUR] }); }); }
    if (er) { er.addEventListener('input', function () { M.rent = parse(er.value) / f(); calc(); }); er.addEventListener('blur', function () { setTimeout(calc, 0); }); er.addEventListener('change', function () { if (window.lmTrack) lmTrack('eco_edit', { key: 'i-rent', label: 'Nájem / měs', value: er.value + ' ' + SYM[CUR] }); }); }
  })();

  [].forEach.call(document.querySelectorAll('#ek-ver button'), function (b) { b.addEventListener('click', function () { VER = b.getAttribute('data-v'); load(VER); show(); }); });
  [].forEach.call(document.querySelectorAll('#ek-cur button'), function (b) { b.addEventListener('click', function () { CUR = b.getAttribute('data-c'); show(); }); });
  $('ek-reset').addEventListener('click', function () { load(VER); show(); });

  load(VER); show();
  var im0 = $('ek-photo'); if (im0) im0.addEventListener('click', function () {
    var ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:14000;display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out';
    ov.onclick = function () { ov.remove(); }; var b = document.createElement('img'); b.src = im0.src; b.style.cssText = 'max-width:96vw;max-height:92vh;border-radius:16px;border:1px solid rgba(79,209,255,.5)'; ov.appendChild(b); document.body.appendChild(ov);
  });
  fetch('/api/compounder/portal/machines').then(function (r) { return r.json(); }).then(function (j) { (j.machines || []).forEach(function (m) { PHOTOS[m.ver] = m.photo; }); photo(); }).catch(function () {});
  // Kurz EUR z ČNB (přes server); při chybě zůstává výchozí
  fetch('/api/ekonomika/fx').then(function (r) { return r.json(); }).then(function (j) {
    if (j && j.rates && j.rates.EUR > 0) { RATES.EUR = j.rates.EUR; if (j.rates.PLN > 0) RATES.PLN = j.rates.PLN; show(); }
  }).catch(function () {});
})();
