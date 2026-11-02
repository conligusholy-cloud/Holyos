// Laundromats — výpočet živého modelu ekonomiky (běží v prohlížeči). Model drží hodnoty v EUR, zobrazuje ve zvolené měně.
(function () {
  'use strict';
  var T = window.EKO_T || {};
  var LOC = (document.documentElement.lang === 'pl') ? 'pl-PL' : 'cs-CZ';
  var VARIANTS = {
    V3: { machine: 52000, conn: 2889, spend: 11.33, cost: 767, perday: 8 },
    V2: { machine: 35000, conn: 1926, spend: 16.52, cost: 647, perday: 5 }
  };
  var PERMIT = 825;
  var RATES = { CZK: 1, EUR: 24.35, PLN: 1 / 0.1807 }; // CZK za 1 jednotku
  var SYM = { CZK: 'Kč', EUR: '€', PLN: 'zł' };
  var CUR = T.defCur || 'CZK', VER = 'V3';
  var M = { machine: 0, permit: 0, conn: 0, spend: 0, cost: 0, perday: 0 }; // v EUR (perday ks)
  var $ = function (id) { return document.getElementById(id); };
  var f = function () { return RATES.EUR / RATES[CUR]; }; // EUR → zobrazená měna
  var fmt = function (v, d) { return (Number(v) || 0).toLocaleString(LOC, { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }); };
  var parse = function (s) { var n = parseFloat(String(s).replace(/[\s ]/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };

  function load(v) { var c = VARIANTS[v]; M.machine = c.machine; M.permit = PERMIT; M.conn = c.conn; M.spend = c.spend; M.cost = c.cost; M.perday = c.perday; }
  function show() {
    var k = f(), S = SYM[CUR];
    $('i-machine').value = fmt(M.machine * k); $('i-permit').value = fmt(M.permit * k); $('i-conn').value = fmt(M.conn * k);
    $('i-spend').value = fmt(M.spend * k, 2); $('i-cost').value = fmt(M.cost * k); $('i-perday').value = String(M.perday);
    [].forEach.call(document.querySelectorAll('.u-cur'), function (e) { e.textContent = S; });
    [].forEach.call(document.querySelectorAll('#ek-ver button'), function (b) { b.classList.toggle('on', b.getAttribute('data-v') === VER); });
    [].forEach.call(document.querySelectorAll('#ek-cur button'), function (b) { b.classList.toggle('on', b.getAttribute('data-c') === CUR); });
    calc();
  }
  function calc() {
    var k = f(), S = ' ' + SYM[CUR];
    var invest = (M.machine + M.permit + M.conn) * k;
    var custMonth = M.perday * 30.5;
    var revenue = custMonth * M.spend * k;
    var profit = revenue - M.cost * k;
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
  bind('i-machine', 'machine', true); bind('i-permit', 'permit', true); bind('i-conn', 'conn', true); bind('i-perday', 'perday', false);

  [].forEach.call(document.querySelectorAll('#ek-ver button'), function (b) { b.addEventListener('click', function () { VER = b.getAttribute('data-v'); load(VER); show(); }); });
  [].forEach.call(document.querySelectorAll('#ek-cur button'), function (b) { b.addEventListener('click', function () { CUR = b.getAttribute('data-c'); show(); }); });
  $('ek-reset').addEventListener('click', function () { load(VER); show(); });

  load(VER); show();
  // Kurz EUR z ČNB (přes server); při chybě zůstává výchozí
  fetch('/api/ekonomika/fx').then(function (r) { return r.json(); }).then(function (j) {
    if (j && j.rates && j.rates.EUR > 0) { RATES.EUR = j.rates.EUR; if (j.rates.PLN > 0) RATES.PLN = j.rates.PLN; show(); }
  }).catch(function () {});
})();
