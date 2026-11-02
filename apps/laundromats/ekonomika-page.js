// Laundromats — stránka „Ekonomika" (živý model jednoho prádlomatu). Obsah 1:1 podle portálu compounder.world (sekce Provozovatel → Ekonomika),
// vzhled Best Series 2.0 / Laundromats (stejné bx-* karty jako /cesta). Výpočet běží v prohlížeči (/cesta/ekonomika.js), bez databáze.
const CP = require('./cesta-pages');

const TXT = {
  cs: {
    title: 'Ekonomika jednoho prádlomatu', desc: 'Živý model ekonomiky prádlomatu: investice, obrat, zisk a návratnost. Upravte hodnoty podle své lokality.',
    back: '← zpět', eyebrow: 'Ekonomika', h1: 'Ekonomika <span class="g">jednoho prádlomatu</span>',
    lead: 'Živý model. Žlutá pole jsou vstupy — upravte je podle své lokality a okamžitě uvidíte obrat, zisk a návratnost. Hodnoty jsou orientační.',
    vat: 'Všechny ceny jsou uvedené bez DPH.',
    invest: 'Investice celkem', investSub: 'na jedno místo', rev: 'Obrat / měsíc', profit: 'Zisk / měsíc', profitSub: 'po všech nákladech', payback: 'Návratnost',
    variant: 'Varianta', v3: 'FLEX — vyšší kapacita', v2: 'MINI — nižší investice', cur: 'Měna', reset: '↺ Obnovit výchozí hodnoty',
    invTitle: 'Investiční náklady (jednorázové)', machine: 'Cena prádlomatu', permit: 'Projekt + povolení', conn: 'Přípojky', invTotal: 'Investice celkem',
    opTitle: 'Provoz (měsíčně)', perday: 'Zákazníků / den', spend: 'Ø útrata / zákazník', cost: 'Provozní náklady / měs', mprofit: 'Měsíční zisk',
    opNote: 'Náklady = nájem + energie + servis + ostatní. Počítáme 30,5 dne/měsíc.', pcs: 'ks',
    retEyebrow: 'Návratnost', retTitle: 'Kdy se prádlomat vrátí', retLead: 'Návratnost = investice ÷ měsíční zisk. Po jejím dosažení je cashflow čistý výnos.',
    year: 'Roční zisk', yearSub: 'po návratnosti čistý', roi: 'Výnos p.a. (ROI)', roiSub: 'zisk / investice', five: 'Zisk za 5 let', fiveSub: 'jeden prádlomat',
    barTitle: 'Splacení investice v čase', paid: 'Za první rok splaceno {pct} % investice.', loss: 'Při aktuálních hodnotách je provoz ve ztrátě.',
    custMo: 'zákazníků / měs', years: 'let', months: 'měsíců', lossShort: 've ztrátě',
    ctaH: 'Chcete to <span class="g">probrat osobně?</span>', ctaP: 'Domluvte si online schůzku — projdeme čísla pro vaši konkrétní lokalitu.', cta: 'Domluvit schůzku',
    disc: 'Orientační model, nejde o příslib výnosu. Skutečné výsledky závisí na lokalitě a vytížení.',
    detail: 'Zobrazit podrobný přehled', detailNote: 'Podívejte se přesně, odkud tato čísla pocházejí — úplný, upravitelný model.', dTitle: 'Podrobný přehled ekonomiky', dBack: '← zpět na ekonomiku', dLead: 'Úplný, upravitelný model: žlutá pole jsou vstupy, vše ostatní se počítá automaticky. Hodnoty jsou orientační.',
  },
  pl: {
    title: 'Ekonomika jednego automatu pralniczego', desc: 'Interaktywny model ekonomiki automatu pralniczego: inwestycja, obrót, zysk i zwrot. Dostosuj wartości do swojej lokalizacji.',
    back: '← wstecz', eyebrow: 'Ekonomika', h1: 'Ekonomika <span class="g">jednego automatu</span>',
    lead: 'Model na żywo. Żółte pola to dane wejściowe — dostosuj je do swojej lokalizacji i od razu zobacz obrót, zysk i zwrot. Wartości są orientacyjne.',
    vat: 'Wszystkie ceny podano bez VAT.',
    invest: 'Inwestycja łącznie', investSub: 'na jedno miejsce', rev: 'Obrót / miesiąc', profit: 'Zysk / miesiąc', profitSub: 'po wszystkich kosztach', payback: 'Zwrot',
    variant: 'Wariant', v3: 'FLEX — większa wydajność', v2: 'MINI — niższa inwestycja', cur: 'Waluta', reset: '↺ Przywróć wartości domyślne',
    invTitle: 'Koszty inwestycyjne (jednorazowe)', machine: 'Cena automatu', permit: 'Projekt + pozwolenia', conn: 'Przyłącza', invTotal: 'Inwestycja łącznie',
    opTitle: 'Działalność (miesięcznie)', perday: 'Klientów / dzień', spend: 'Ø wydatek / klient', cost: 'Koszty operacyjne / mies.', mprofit: 'Zysk miesięczny',
    opNote: 'Koszty = czynsz + energia + serwis + pozostałe. Przyjmujemy 30,5 dnia/miesiąc.', pcs: 'szt.',
    retEyebrow: 'Zwrot', retTitle: 'Kiedy automat się zwróci', retLead: 'Zwrot = inwestycja ÷ zysk miesięczny. Po jego osiągnięciu cashflow to czysty dochód.',
    year: 'Zysk roczny', yearSub: 'po zwrocie czysty', roi: 'Zwrot p.a. (ROI)', roiSub: 'zysk / inwestycja', five: 'Zysk za 5 lat', fiveSub: 'jeden automat',
    barTitle: 'Spłata inwestycji w czasie', paid: 'W pierwszym roku spłacono {pct} % inwestycji.', loss: 'Przy obecnych wartościach działalność przynosi stratę.',
    custMo: 'klientów / mies.', years: 'lat', months: 'miesięcy', lossShort: 'strata',
    ctaH: 'Chcesz to <span class="g">omówić osobiście?</span>', ctaP: 'Umów się na spotkanie online — przejdziemy przez liczby dla Twojej lokalizacji.', cta: 'Umów spotkanie',
    disc: 'Model orientacyjny, nie stanowi obietnicy dochodu. Rzeczywiste wyniki zależą od lokalizacji i obłożenia.',
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
    <a class="bx-back" data-keep href="/cesta">${t.back}</a>
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
      <span class="ek-seg" id="ek-ver"><span>${t.variant}:</span><button type="button" data-v="V3" class="on" title="${t.v3}">FLEX</button><button type="button" data-v="V2" title="${t.v2}">MINI</button></span>
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
      ${row('i-spend', t.spend, '11.33', 'cur', true)}
      ${row('i-cost', t.cost, '767', 'cur', true)}
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
    <script src="/cesta/ekonomika.js"></script>`;
  return CP.page(t.title, t.desc, main, false);
}

const DCSS = `<style>
  .wrap{max-width:1040px!important}
  #pradlomat-tool-root{--bg:rgba(8,13,28,.82);--surface:rgba(14,22,40,.72);--surface2:rgba(120,160,255,.08);--border:rgba(120,160,255,.22);--text:#eaf2ff;--text2:#8ea2c2;--accent:#4fd1ff;--primary:#4fd1ff;color:var(--text);font-family:inherit}
  #pradlomat-tool-root input,#pradlomat-tool-root select{font-family:inherit}
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
    <script>window.PradlomatTool.mount(document.getElementById('pradlomat-tool-root'),{version:'V3',showVerSwitch:true});</script>`;
  return CP.page(t.dTitle, t.desc, main, false);
}

module.exports = { economyPage, economyDetailPage };
