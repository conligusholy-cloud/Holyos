// Laundromats — stránka „Ekonomika" (živý model jednoho prádlomatu). Obsah 1:1 podle portálu compounder.world (sekce Provozovatel → Ekonomika),
// vzhled Best Series 2.0 / Laundromats (stejné bx-* karty jako /cesta). Výpočet běží v prohlížeči (/cesta/ekonomika.js), bez databáze.
const CP = require('./cesta-pages');

const TXT = {
  cs: {
    title: 'Kalkulačka ekonomiky prádlomatu', desc: 'Modelovací kalkulačka: zadejte vlastní předpoklady a spočítejte si investici, obrat, výsledek a návratnost prádlomatu.',
    back: '← zpět', eyebrow: 'Kalkulačka', h1: 'Kalkulačka <span class="g">ekonomiky prádlomatu</span>',
    lead: 'Modelovací nástroj pro vaši představu. Žlutá pole vyplňte podle svých předpokladů — kalkulačka hned spočítá obrat, výsledek a návratnost.',
    vat: 'Předvyplněná čísla jsou jen ukázka. Výsledek odpovídá výhradně hodnotám, které zadáte — nejde o odhad ani příslib zisku. Všechny ceny jsou bez DPH.',
    invest: 'Investice celkem', investSub: 'podle zadaných hodnot', rev: 'Obrat / měsíc', profit: 'Výsledek / měsíc', profitSub: 'podle zadaných hodnot, po nákladech', payback: 'Návratnost (model)',
    variant: 'Varianta', v3: 'FLEX — vyšší kapacita', v2: 'MINI — nižší investice', cur: 'Měna', reset: '↺ Ukázkové hodnoty',
    invTitle: 'Investiční náklady (jednorázové)', machine: 'Cena prádlomatu', permit: 'Projekt + povolení', conn: 'Přípojky', invTotal: 'Investice celkem',
    opTitle: 'Provoz (měsíčně)', perday: 'Zákazníků / den', spend: 'Ø útrata / zákazník (bez DPH)', rent: 'Nájem / měs', cost: 'Provozní náklady / měs', mprofit: 'Výsledek / měsíc',
    opNote: 'Provozní náklady = nájem + energie a voda na praní (rostou s počtem zákazníků) + servis, software, pojištění a ostatní. Počítáme 30,5 dne/měsíc.', pcs: 'ks',
    retEyebrow: 'Návratnost', retTitle: 'Kdy by se investice vrátila', retLead: 'Návratnost = investice ÷ měsíční výsledek z hodnot, které jste zadali.',
    year: 'Roční výsledek', yearSub: 'podle zadaných hodnot', roi: 'Výnos p.a. (ROI)', roiSub: 'výsledek / investice', five: 'Výsledek za 5 let', fiveSub: 'po odečtení investice',
    barTitle: 'Splacení investice v čase (model)', paid: 'Při zadaných hodnotách by se za první rok splatilo {pct} % investice.', loss: 'Při zadaných hodnotách vychází provoz ve ztrátě.',
    custMo: 'zákazníků / měs', years: 'let', months: 'měsíců', lossShort: 've ztrátě',
    ctaH: 'Chcete to <span class="g">probrat osobně?</span>', ctaP: 'Domluvte si online schůzku — projdeme čísla pro vaši konkrétní lokalitu.', cta: 'Domluvit schůzku',
    disc: 'Kalkulačka je modelovací nástroj. Výsledky vycházejí pouze z hodnot, které zadáte, a nejsou odhadem, nabídkou ani příslibem zisku či návratnosti. Skutečné výsledky závisí na lokalitě, vytížení, cenách a dalších okolnostech.',
    detail: 'Podrobná kalkulačka', detailNote: 'Všechny vstupy kalkulace v detailu — ceny služeb, energie, spotřeba i jednotlivé náklady si nastavíte sami.', dTitle: 'Podrobná kalkulačka ekonomiky', dBack: '← zpět na kalkulačku', dLead: 'Úplný modelovací nástroj: žlutá pole jsou vaše vstupy, vše ostatní se dopočítá. Výsledky odpovídají jen zadaným hodnotám — nejde o odhad ani příslib zisku.',
  },
  pl: {
    title: 'Kalkulator ekonomiki automatu pralniczego', desc: 'Interaktywny model ekonomiki automatu pralniczego: inwestycja, obrót, zysk i zwrot. Dostosuj wartości do swojej lokalizacji.',
    back: '← wstecz', eyebrow: 'Ekonomika', h1: 'Kalkulator <span class="g">ekonomiki automatu</span>',
    lead: 'Narzędzie do modelowania Twojego pomysłu. Wypełnij żółte pola według własnych założeń — kalkulator od razu policzy obrót, wynik i zwrot.',
    vat: 'Wstępnie wpisane liczby to tylko przykład. Wynik zależy wyłącznie od wprowadzonych wartości — nie jest to prognoza ani obietnica zysku. Ceny bez VAT.',
    invest: 'Inwestycja łącznie', investSub: 'na jedno miejsce', rev: 'Obrót / miesiąc', profit: 'Wynik / miesiąc', profitSub: 'według wprowadzonych wartości', payback: 'Zwrot (model)',
    variant: 'Wariant', v3: 'FLEX — większa wydajność', v2: 'MINI — niższa inwestycja', cur: 'Waluta', reset: '↺ Przywróć wartości domyślne',
    invTitle: 'Koszty inwestycyjne (jednorazowe)', machine: 'Cena automatu', permit: 'Projekt + pozwolenia', conn: 'Przyłącza', invTotal: 'Inwestycja łącznie',
    opTitle: 'Działalność (miesięcznie)', perday: 'Klientów / dzień', spend: 'Ø wydatek / klient (bez VAT)', rent: 'Czynsz / mies.', cost: 'Koszty operacyjne / mies.', mprofit: 'Wynik / miesiąc',
    opNote: 'Koszty = czynsz + energia + serwis + pozostałe. Przyjmujemy 30,5 dnia/miesiąc.', pcs: 'szt.',
    retEyebrow: 'Zwrot', retTitle: 'Kiedy automat się zwróci', retLead: 'Zwrot = inwestycja ÷ zysk miesięczny. Po jego osiągnięciu cashflow to czysty dochód.',
    year: 'Zysk roczny', yearSub: 'po zwrocie czysty', roi: 'Zwrot p.a. (ROI)', roiSub: 'zysk / inwestycja', five: 'Zysk za 5 lat', fiveSub: 'jeden automat',
    barTitle: 'Spłata inwestycji w czasie', paid: 'W pierwszym roku spłacono {pct} % inwestycji.', loss: 'Przy obecnych wartościach działalność przynosi stratę.',
    custMo: 'klientów / mies.', years: 'lat', months: 'miesięcy', lossShort: 'strata',
    ctaH: 'Chcesz to <span class="g">omówić osobiście?</span>', ctaP: 'Umów się na spotkanie online — przejdziemy przez liczby dla Twojej lokalizacji.', cta: 'Umów spotkanie',
    disc: 'Kalkulator to narzędzie do modelowania. Wyniki wynikają wyłącznie z wprowadzonych wartości i nie stanowią prognozy, oferty ani obietnicy zysku lub zwrotu.',
    detail: 'Pokaż szczegółowe zestawienie', detailNote: 'Zobacz dokładnie, skąd pochodzą te liczby — pełny, edytowalny model.', dTitle: 'Szczegółowa ekonomika', dBack: '← wróć do ekonomiki', dLead: 'Pełny, edytowalny model: żółte pola to dane wejściowe, reszta liczy się automatycznie. Wartości są orientacyjne.',
  },
};

const CSS = `<style>
  .ek-metrics{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:6px 0 18px}
  .ek-m{position:relative;background:var(--card);border:1px solid rgba(120,160,255,.18);border-radius:15px;padding:16px 16px 14px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
  .ek-m .k{font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted2);font-weight:600}
  .ek-m .v{font-size:clamp(21px,5.8vw,28px);font-weight:800;letter-spacing:-.02em;margin-top:6px;white-space:nowrap}
  .ek-m .v.g{background:linear-gradient(90deg,#4fd1ff,#8fd0ff 50%,#7c5cff);-webkit-background-clip:text;background-clip:text;color:transparent}
  .ek-m .s{font-size:12.5px;color:var(--muted);margin-top:4px}
  .ek-m .b4{font-size:12.5px;color:var(--muted);text-decoration:line-through;margin-top:2px}
  .ek-bar{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:0 0 14px}
  .ek-seg{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}
  .ek-seg>span{font-size:12px;color:var(--muted);margin-right:2px}
  .ek-seg button,.ek-reset{cursor:pointer;font:inherit;font-size:13px;font-weight:700;color:var(--text);background:rgba(120,160,255,.08);border:1px solid rgba(120,160,255,.28);border-radius:10px;padding:7px 13px;transition:filter .15s,background .15s}
  .ek-seg button.on{background:linear-gradient(90deg,#1e86e0,#7c5cff);border-color:transparent;color:#fff}
  .ek-reset{font-weight:600;color:var(--muted)} .ek-seg button:hover,.ek-reset:hover{filter:brightness(1.15)}
  .ek-panel{position:relative;background:var(--card);border:1px solid rgba(120,160,255,.18);border-radius:15px;padding:18px 18px 12px;margin-bottom:14px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
  .ek-panel h3{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--blue-soft);font-weight:600;margin-bottom:8px}
  .ek-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid rgba(120,160,255,.10)}
  .ek-row:first-of-type{border-top:0}
  .ek-row label{font-size:14.5px;color:var(--text)}
  .ek-unit{display:flex;align-items:center;gap:7px}
  .ek-unit input{width:128px;max-width:42vw;text-align:right;font:inherit;font-size:15px;font-weight:700;color:#ffd866;background:rgba(255,205,60,.07);border:1px solid rgba(255,205,60,.38);border-radius:10px;padding:8px 11px;outline:none}
  .ek-unit input:focus{border-color:#ffd866;box-shadow:0 0 0 3px rgba(255,205,60,.15)}
  .ek-unit input[readonly]{color:var(--text);background:rgba(120,160,255,.06);border-color:rgba(120,160,255,.2)}
  .ek-unit .u{font-size:13px;color:var(--muted);min-width:26px}
  .ek-note{font-size:12px;color:var(--muted2);margin:6px 0 8px}
  .ek-track{height:10px;border-radius:6px;background:rgba(120,160,255,.14);overflow:hidden;margin:12px 0 6px}
  .ek-fill{height:100%;width:0;background:linear-gradient(90deg,#3ee08a,#4fd1ff);border-radius:6px;transition:width .35s}
  .ek-photo{float:right;width:300px;max-width:44%;aspect-ratio:4/3;object-fit:cover;border-radius:18px;border:1px solid rgba(79,209,255,.45);margin:4px 0 14px 18px;cursor:zoom-in;box-shadow:0 20px 60px -24px rgba(58,108,245,.7);background:rgba(120,160,255,.06)}
  @media(max-width:520px){.ek-photo{float:none;display:block;width:100%;max-width:100%;margin:0 0 14px}}
  @media(min-width:560px){.ek-metrics{grid-template-columns:1fr 1fr}}
</style>`;

const row = (id, label, val, unit, ro) => `<div class="ek-row"><label for="${id}">${label}</label><div class="ek-unit"><input type="text" inputmode="decimal" id="${id}" value="${val}"${ro ? ' readonly' : ''}><span class="u${unit === 'cur' ? ' u-cur' : ''}">${unit === 'cur' ? 'Kč' : unit}</span></div></div>`;

function economyPage(lang) {
  const t = TXT[lang] || TXT.cs;
  const pl = lang === 'pl';
  const main = `${CSS}
    <a class="bx-back" href="${pl ? '/cesta/pl' : (process.env.LM_HOME_LIVE === '1' ? '/' : '/uvod')}" onclick="try{if(document.referrer&&new URL(document.referrer).host===location.host&&history.length>1){history.back();return false;}}catch(e){}return true;">${t.back}</a>
    <img class="ek-photo" id="ek-photo" src="/img/pradlomat-mini.webp" alt="Prádlomat">
    <p class="bx-eyebrow">${t.eyebrow}</p>
    <h1>${t.h1}</h1>
    <p class="bx-lead">${t.lead}</p>
    <p class="ek-note" style="margin-top:-10px">${t.vat}</p>

    <div class="ek-metrics" style="clear:both">
      <div class="ek-m"><div class="k">${t.invest}</div><div class="v g" id="m-invest">—</div><div class="b4" id="m-invest-before" style="display:none"></div><div class="s">${t.investSub}</div></div>
      <div class="ek-m"><div class="k">${t.rev}</div><div class="v" id="m-revenue">—</div><div class="s" id="m-cust">—</div></div>
      <div class="ek-m"><div class="k">${t.profit}</div><div class="v" id="m-profit">—</div><div class="s">${t.profitSub}</div></div>
      <div class="ek-m"><div class="k">${t.payback}</div><div class="v g" id="m-payback">—</div><div class="s" id="m-payback-m">—</div></div>
    </div>

    <div class="ek-bar">
      <span class="ek-seg" id="ek-ver"><span>${t.variant}:</span><button type="button" data-v="V2" class="on" title="${t.v2}">MINI</button><button type="button" data-v="V3" title="${t.v3}">FLEX</button></span>
      <span class="ek-seg" id="ek-cur"><span>${t.cur}:</span><button type="button" data-c="CZK">CZK</button><button type="button" data-c="EUR">EUR</button><button type="button" data-c="PLN">PLN</button></span>
      <button type="button" class="ek-reset" id="ek-reset">${t.reset}</button>
    </div>

    <div class="ek-panel" id="ek-invest-panel">
      <h3>${t.invTitle}</h3>
      ${row('i-machine', t.machine, '52000', 'cur')}
      ${row('i-permit', t.permit, '825', 'cur')}
      ${row('i-conn', t.conn, '2889', 'cur')}
      ${row('o-invest', t.invTotal, '', 'cur', true)}
    </div>
    <div class="ek-panel">
      <h3>${t.opTitle}</h3>
      ${row('i-perday', t.perday, '8', t.pcs)}
      ${row('i-spend', t.spend, '14.8', 'cur')}
      ${row('i-rent', t.rent, '120', 'cur')}
      ${row('i-cost', t.cost, '647', 'cur', true)}
      ${row('o-profit', t.mprofit, '', 'cur', true)}
      <p class="ek-note">${t.opNote}</p>
    </div>

    <div class="bx-hr">${t.retEyebrow}</div>
    <div class="bx-card"><div class="bx-in">
      <p class="bx-q-eyebrow">${t.retEyebrow}</p>
      <h2 class="bx-q-h">${t.retTitle}</h2>
      <p class="bx-q-sub">${t.retLead}</p>
      <div class="ek-metrics" style="position:relative;margin-bottom:6px">
        <div class="ek-m"><div class="k">${t.year}</div><div class="v" id="r-yearprofit">—</div><div class="s">${t.yearSub}</div></div>
        <div class="ek-m"><div class="k">${t.roi}</div><div class="v" id="r-roi">—</div><div class="s">${t.roiSub}</div></div>
        <div class="ek-m"><div class="k">${t.five}</div><div class="v" id="r-5y">—</div><div class="s">${t.fiveSub}</div></div>
        <div class="ek-m"><div class="k">${t.payback}</div><div class="v g" id="r-payback">—</div><div class="s" id="r-payback-m">—</div></div>
      </div>
      <p class="bx-q-sub" style="position:relative;margin:14px 0 0;font-size:13px">${t.barTitle}</p>
      <div class="ek-track" style="position:relative"><div class="ek-fill" id="r-bar"></div></div>
      <p class="bx-note" id="r-bar-note" style="position:relative"></p>
    </div></div>

    <div style="margin:26px 0 6px;text-align:center"><div class="bx-card" style="display:inline-block;margin-bottom:10px"><div class="bx-in" style="padding:0"><a class="bx-path" data-keep href="${pl ? '/cesta/pl/ekonomika/podrobne' : '/cesta/ekonomika/podrobne'}" style="padding:14px 28px;flex-direction:row;border-radius:16px">${t.detail}</a></div></div><p class="ek-note">${t.detailNote}</p></div>

    <div class="bx-closing" style="margin-top:34px"><h2>${t.ctaH}</h2><p>${t.ctaP}</p></div>
    <div class="bx-card"><div class="bx-in bx-center"><div class="bx-paths" style="grid-template-columns:1fr"><a class="bx-path" data-keep href="/cesta/schuzka">${t.cta}<small>→</small></a></div></div></div>
    <p class="bx-disc">${t.disc}</p>
    <script>window.EKO_T=${JSON.stringify({ years: t.years, months: t.months, loss: t.lossShort, custMo: t.custMo, paid: t.paid, lossNote: t.loss, defCur: pl ? 'PLN' : 'CZK' })};</script>
    <script src="/cesta/pradlomat-economy.js"></script><script src="/cesta/ekonomika.js"></script>`;
  return CP.page(t.title, t.desc, main, false);
}

const DCSS = `<style>
  .wrap{max-width:1040px!important}
  #pradlomat-tool-root{--bg:rgba(8,13,28,.55);--surface:rgba(14,22,40,.72);--surface2:rgba(120,160,255,.07);--border:rgba(120,160,255,.2);--text:#eaf2ff;--text2:#8ea2c2;color:var(--text);font-family:inherit}
  #pradlomat-tool-root input,#pradlomat-tool-root select,#pradlomat-tool-root button{font-family:inherit}
  /* lišta nástrojů */
  #pradlomat-tool-root .pe-toolbar{background:var(--card);border:1px solid rgba(120,160,255,.18);border-radius:15px;padding:14px 16px;gap:10px 14px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
  #pradlomat-tool-root .pe-toolbar .pe-legend{font-size:12px;color:var(--muted)}
  #pradlomat-tool-root .pe-toolbar .pe-legend .pe-sw{width:18px;height:18px;border-radius:6px;background:rgba(255,205,60,.07);border:1px solid rgba(255,205,60,.38)}
  #pradlomat-tool-root .pe-toolbar .pe-legend .pe-sw.ro{background:rgba(79,209,255,.08);border:1px solid rgba(79,209,255,.35)}
  #pradlomat-tool-root .pe-toolbar span[style*="font-size:12px"]{color:var(--muted)!important}
  #pradlomat-tool-root .btn,#pradlomat-tool-root .pe-chip{cursor:pointer;font-size:13px;font-weight:700;color:var(--text);background:rgba(120,160,255,.08);border:1px solid rgba(120,160,255,.28);border-radius:10px;padding:7px 13px!important;transition:filter .15s}
  #pradlomat-tool-root .btn:hover{filter:brightness(1.18)}
  #pradlomat-tool-root .pe-chip.pe-on{background:linear-gradient(90deg,#1e86e0,#7c5cff);border-color:transparent;color:#fff}
  #pradlomat-tool-root .btn-secondary{font-weight:600;color:var(--muted)}
  /* výsledné dlaždice */
  #pradlomat-tool-root .pe-results{background:none;border:0;padding:0;grid-template-columns:1fr 1fr;gap:12px;clear:none}
  #pradlomat-tool-root .pe-result-card{background:var(--card);border:1px solid rgba(120,160,255,.18);border-radius:15px;padding:16px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
  #pradlomat-tool-root .pe-rc-label{font-size:11px!important;letter-spacing:.13em!important;color:var(--muted2)!important}
  #pradlomat-tool-root .pe-rc-value{font-size:clamp(21px,5.2vw,28px)!important;font-weight:800!important;letter-spacing:-.02em;color:var(--text)!important}
  #pradlomat-tool-root #pe-rc-investice .pe-rc-value,#pradlomat-tool-root #pe-rc-navratnost .pe-rc-value{background:linear-gradient(90deg,#4fd1ff,#8fd0ff 50%,#7c5cff);-webkit-background-clip:text;background-clip:text;color:transparent!important}
  #pradlomat-tool-root .pe-result-card.neg .pe-rc-value{background:none;color:#ef4444!important}
  #pradlomat-tool-root .pe-result-card .pe-rc-sub{color:var(--muted)}
  /* fotka */
  #pradlomat-tool-root .pe-verphoto{border:1px solid rgba(79,209,255,.45);border-radius:18px;animation:none;box-shadow:0 20px 60px -24px rgba(58,108,245,.75)}
  /* sekce */
  #pradlomat-tool-root .pe-section{background:var(--card);border:1px solid rgba(120,160,255,.18);border-radius:15px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
  #pradlomat-tool-root .pe-section-head{background:transparent;border-bottom:1px solid rgba(120,160,255,.14);padding:14px 18px}
  #pradlomat-tool-root .pe-section-head h3{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--blue-soft);font-weight:600}
  #pradlomat-tool-root .pe-section-head .pe-h-tag{color:var(--muted2)}
  #pradlomat-tool-root .pe-section-head{gap:12px}
  #pradlomat-tool-root .pe-section-head .pe-h-icon{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:11px;color:#4fd1ff;background:linear-gradient(135deg,rgba(79,209,255,.14),rgba(124,92,255,.16));border:1px solid rgba(120,160,255,.28);flex:0 0 auto}
  #pradlomat-tool-root .pe-section-head .pe-chev{color:var(--muted2);transition:transform .2s;flex:0 0 auto}
  #pradlomat-tool-root .pe-section:not(.pe-collapsed) .pe-chev{transform:rotate(180deg)}
  #pradlomat-tool-root .pe-section.pe-collapsed .pe-section-head{border-bottom-color:transparent}
  #pradlomat-tool-root .pe-section-head:hover .pe-h-icon{filter:brightness(1.25)}
  #pradlomat-tool-root .pe-section-body{padding:12px 18px}
  #pradlomat-tool-root .pe-row{padding:5px 0;border-top:1px solid rgba(120,160,255,.08);font-size:14.5px}
  #pradlomat-tool-root .pe-row:first-child{border-top:0}
  #pradlomat-tool-root .pe-row .pe-unit{color:var(--muted)}
  /* vstupy: žluté pole = vstup (jako na hlavní stránce) */
  #pradlomat-tool-root .pe-input{background:rgba(255,205,60,.07);color:#ffd866;border:1px solid rgba(255,205,60,.38);border-radius:10px;padding:8px 11px;font-size:15px;font-weight:700}
  #pradlomat-tool-root .pe-input:focus{border-color:#ffd866;box-shadow:0 0 0 3px rgba(255,205,60,.15)}
  #pradlomat-tool-root .pe-readonly{background:rgba(79,209,255,.08);border:1px solid rgba(79,209,255,.35);border-radius:10px;padding:8px 11px;font-size:15px;font-weight:700;color:#4fd1ff}
  #pradlomat-tool-root .pe-readonly.emp{background:rgba(79,209,255,.08);color:#4fd1ff;border-color:rgba(79,209,255,.35)}
  #pradlomat-tool-root .pe-info{background:rgba(79,209,255,.07);border-color:rgba(79,209,255,.3);color:#b9dcf3;border-radius:12px}
  #pradlomat-tool-root .pe-warn{border-radius:12px}
  @media(max-width:520px){#pradlomat-tool-root .pe-results{grid-template-columns:1fr}}
</style>`;
function economyDetailPage(lang) {
  const t = TXT[lang] || TXT.cs;
  const back = lang === 'pl' ? '/cesta/pl/ekonomika' : '/cesta/ekonomika';
  const main = `${DCSS}
    <a class="bx-back" data-keep href="${back}">${t.dBack}</a>
    <p class="bx-eyebrow">${t.eyebrow}</p>
    <h1>${t.dTitle}</h1>
    <p class="bx-lead" style="max-width:720px">${t.dLead}</p>
    <div id="pradlomat-tool-root"></div>
    <script src="/cesta/pradlomat-economy.js"></script>
    <script>window.PradlomatTool.mount(document.getElementById('pradlomat-tool-root'),{version:'V2',showVerSwitch:true});
    // Kurzy z ČNB (stejné jako na stránce Ekonomika) — jinak by podrobný přehled v Kč počítal s pevným kurzem 25 Kč/€
    fetch('/api/ekonomika/fx').then(function(r){return r.json();}).then(function(j){if(j&&j.rates&&j.rates.EUR>0&&window.PradlomatTool.setRates)window.PradlomatTool.setRates(Object.assign({EUR:25,USD:23,GBP:29},j.rates));}).catch(function(){});
    (function(){var r=document.getElementById('pradlomat-tool-root'),tm={};if(window.lmTrack)lmTrack('eco_open',{view:'detail'});
      r.addEventListener('change',function(ev){var i=ev.target;if(!i||!i.getAttribute)return;var k=i.getAttribute('data-key');if(!k)return;var row=i.closest('.pe-row'),lb=row&&row.querySelector('label');clearTimeout(tm[k]);tm[k]=setTimeout(function(){if(window.lmTrack)lmTrack('eco_edit',{key:k,label:lb?lb.textContent.trim().slice(0,60):k,value:i.value});},400);});})();</script>`;
  return CP.page(t.dTitle, t.desc, main, false);
}

module.exports = { economyPage, economyDetailPage };
