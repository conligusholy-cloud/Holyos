// BS2 — Aréna (/arena): záchytná stránka ve stylu „Milionáře". Návštěvník zadá, jak mu máme říkat,
// pak odpovídá na 5 otázek (3 možnosti, 15 s na otázku); za každou správnou odpověď +50 000 Kč
// „startovního kapitálu". Na konci CTA na Prověření lokality. Výsledky se ukládají (arena_runs).
const { esc } = require('./views');

// Otázky: uprav text / možnosti / index správné odpovědi (0–2). Vysvětlení se ukáže po odpovědi.
const QUESTIONS = [
  { q: 'Kolik lidí obsluhuje samoobslužný prádlomat FLEX během běžného dne?', a: ['Jeden zaměstnanec na směně', 'Nikdo – zákazník si pere sám, platí kartou nebo mincemi', 'Dva lidé – obsluha a údržba'], c: 1, why: 'Prádlomat je plně samoobslužný: žádné mzdy, žádná otevírací doba – pere se 24 hodin denně.' },
  { q: 'Jak dlouho trvá jeden kompletní cyklus praní a sušení v prádlomatu?', a: ['Zhruba 60–75 minut', 'Celý půlden', 'Asi 3 hodiny'], c: 0, why: 'Praní cca 30–40 minut a sušení dalších 30–40 minut – zákazník mezitím nakoupí nebo si dá kávu.' },
  { q: 'Co nejvíc rozhoduje o výdělku prádlomatu?', a: ['Barva stroje', 'Místo – kolik lidí kolem něj denně projde', 'Cena elektřiny v regionu'], c: 1, why: 'Lokalita je 80 % úspěchu. Proto si ji před investicí prověřujeme v aplikaci Prověření lokality.' },
  { q: 'Co všechno lze v prádlomatu FLEX vyprat?', a: ['Jen běžné oblečení', 'Oblečení, peřiny, deky, spacáky i boty', 'Pouze ručníky a ložní prádlo'], c: 1, why: 'Velkokapacitní buben zvládne i peřiny, deky nebo spacáky, které se do domácí pračky nevejdou.' },
  { q: 'Kdo za vás řeší servis a dohled nad prádlomatem Best Series?', a: ['Výrobce – vzdálený dohled a servisní síť', 'Nikdo, vše je na majiteli', 'Externí firma, kterou si musíte sehnat'], c: 0, why: 'Stroj hlásí stav online a servisní tým Best Series řeší údržbu i poruchy – majitel sleduje jen tržby.' },
];
const PRIZE = 50000;      // Kč za správnou odpověď
const SECONDS = 15;       // čas na otázku

const PAGE = (shellHead, netScript, presence) => `${shellHead}
<style>
  .arena-hero{text-align:center;padding:26px 0 10px}
  .arena-hero h1{font-size:clamp(32px,5.6vw,58px);margin:12px auto 8px;max-width:900px}
  .arena-hero .lead{margin:0 auto;max-width:620px}
  .machine{display:flex;justify-content:center;margin:18px 0 6px}
  .machine img{width:min(70%,420px);height:auto;animation:pmfloat 5s ease-in-out infinite;filter:drop-shadow(0 24px 48px rgba(30,134,224,.45)) drop-shadow(0 0 30px rgba(79,209,255,.18))}
  .bank{display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin:6px 0 16px}
  .bank .chip{display:inline-flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--border2);border-radius:999px;padding:8px 16px;font-weight:700;font-variant-numeric:tabular-nums}
  .bank .chip b{font-size:20px;background:linear-gradient(90deg,#ffd866,#f5b400);-webkit-background-clip:text;background-clip:text;color:transparent}
  .bank .chip.pop b{animation:pop .6s ease}
  @keyframes pop{0%{transform:scale(1)}40%{transform:scale(1.35)}100%{transform:scale(1)}}
  .fly{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);font-size:clamp(28px,6vw,54px);font-weight:900;color:#ffd866;text-shadow:0 0 30px rgba(245,180,0,.6);pointer-events:none;z-index:50;animation:fly 1.3s ease-out forwards}
  @keyframes fly{0%{opacity:0;transform:translate(-50%,-30%) scale(.6)}20%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}100%{opacity:0;transform:translate(-50%,-160%) scale(.9)}}
  .quiz{max-width:760px;margin:0 auto;background:var(--card);border:1px solid var(--border);border-radius:20px;padding:22px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 20px 60px rgba(0,0,0,.35)}
  .quiz .top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
  .quiz .step{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--text2)}
  .timer{position:relative;width:54px;height:54px;flex:none}
  .timer svg{transform:rotate(-90deg)} .timer circle{fill:none;stroke-width:5}
  .timer .bg{stroke:rgba(120,160,255,.15)} .timer .fg{stroke:var(--accent2);stroke-linecap:round;transition:stroke-dashoffset 1s linear,stroke .3s}
  .timer.hot .fg{stroke:var(--err)}
  .timer b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:16px;font-variant-numeric:tabular-nums}
  .quiz h2{font-size:clamp(19px,3vw,25px);margin:4px 0 16px;line-height:1.3}
  .opts{display:flex;flex-direction:column;gap:10px}
  .opt{display:flex;align-items:center;gap:12px;text-align:left;font:inherit;font-size:16px;color:var(--text);background:var(--card2);border:1px solid var(--border);border-radius:14px;padding:14px 16px;cursor:pointer;transition:transform .15s,border-color .15s,background .15s}
  .opt:hover{border-color:var(--accent2);transform:translateX(4px)}
  .opt .k{flex:none;width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-weight:800;background:linear-gradient(135deg,rgba(30,134,224,.35),rgba(124,92,255,.35));border:1px solid var(--border2);color:var(--accent2)}
  .opt.ok{border-color:var(--ok);background:rgba(47,227,160,.14)} .opt.bad{border-color:var(--err);background:rgba(255,93,108,.14)}
  .opt:disabled{cursor:default;transform:none}
  .why{margin-top:14px;font-size:14.5px;color:var(--text2);border-left:3px solid var(--accent2);padding:6px 12px;display:none}
  .why.show{display:block}
  .next{margin-top:16px;display:flex;justify-content:flex-end}
  .result{text-align:center}
  .result .big{font-size:clamp(36px,7vw,64px);font-weight:900;letter-spacing:-.03em;background:linear-gradient(90deg,#ffd866,#f5b400);-webkit-background-clip:text;background-clip:text;color:transparent;margin:6px 0}
  .result p{color:var(--text2);max-width:560px;margin:8px auto}
  /* úvodní okno „jak vám máme říkat" */
  .ov{position:fixed;inset:0;background:rgba(4,6,12,.78);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:40;display:flex;align-items:center;justify-content:center;padding:18px}
  .ov .box{width:min(100%,460px);background:var(--card);border:1px solid var(--border2);border-radius:20px;padding:26px;box-shadow:0 30px 80px rgba(0,0,0,.6);text-align:center}
  .ov h2{margin-bottom:6px} .ov p{color:var(--text2);font-size:14.5px;margin-bottom:16px}
  .ov input{text-align:center;font-size:18px}
  .ov .btn{width:100%;margin-top:12px}
  .hidden{display:none !important}
  @media (max-width:600px){.quiz{padding:16px}.opt{font-size:15px;padding:12px 13px}.machine img{width:min(80%,300px)}}
</style>
</head>
<body><canvas id="net" aria-hidden="true"></canvas><div class="glow a"></div><div class="glow b"></div><div class="gridfx" aria-hidden="true"></div>
${presence}
<main>
  <section class="arena-hero">
    <span class="eyebrow"><i></i>Aréna Best Series · 5 otázek · 15 vteřin na každou</span>
    <h1>Vydělejte si <span class="g">startovní kapitál</span> na vlastní prádlomat</h1>
    <p class="lead">Za každou správnou odpověď získáte <mark>+${PRIZE.toLocaleString('cs-CZ')} Kč</mark> virtuálního kapitálu. Zvládnete všech pět?</p>
    <div class="machine"><img src="/img/pradlomat.webp?v=2" alt="Prádlomat FLEX" width="460" height="350" loading="eager" decoding="async"></div>
    <div class="bank"><span class="chip" id="bank">💰 <b id="bankv">0 Kč</b></span><span class="chip" id="who" style="display:none">🙋 <span id="whon"></span></span></div>
  </section>

  <section class="quiz hidden" id="quiz">
    <div class="top"><span class="step" id="step">Otázka 1 z ${QUESTIONS.length}</span><div class="timer" id="timer"><svg width="54" height="54" viewBox="0 0 54 54"><circle class="bg" cx="27" cy="27" r="23"/><circle class="fg" id="tfg" cx="27" cy="27" r="23"/></svg><b id="tsec">${SECONDS}</b></div></div>
    <h2 id="qtext"></h2>
    <div class="opts" id="opts"></div>
    <div class="why" id="why"></div>
    <div class="next"><button class="btn hidden" id="next">Další otázka →</button></div>
  </section>

  <section class="quiz result hidden" id="result">
    <span class="eyebrow"><i></i>Hotovo</span>
    <div class="big" id="rbig"></div>
    <h2 id="rtitle"></h2>
    <p id="rtext"></p>
    <div class="cta-row" style="justify-content:center">
      <a class="btn" href="/location?utm_source=arena" id="rcta">Prověřit si místo pro prádlomat</a>
      <button class="btn sec" id="again">Hrát znovu</button>
    </div>
    <p class="small" style="margin-top:14px;color:var(--text3)">Kapitál je virtuální – ale prádlomat je skutečný. Aplikace Prověření lokality vám spočítá, kolik by vydělal právě u vás.</p>
  </section>
</main>

<div class="ov" id="ov">
  <form class="box" id="nameForm">
    <span class="eyebrow"><i></i>Než začneme</span>
    <h2 style="margin-top:10px">Jak vám máme říkat?</h2>
    <p>Jen křestní jméno nebo přezdívka – ať víme, komu připisovat kapitál.</p>
    <input type="text" id="nm" maxlength="40" placeholder="např. Tomáš" autocomplete="given-name" autofocus required>
    <button class="btn" type="submit">Jdu do toho →</button>
  </form>
</div>

<script>
${netScript}
(function(){
  var Q = ${JSON.stringify(QUESTIONS)}, PRIZE = ${PRIZE}, SEC = ${SECONDS};
  var SID = (function(){ try { var k='misto_sid', v=sessionStorage.getItem(k); if(!v){ v=Math.random().toString(36).slice(2)+Date.now().toString(36); sessionStorage.setItem(k,v);} return v; } catch(e){ return 'x'; } })();
  var name = '', i = 0, bank = 0, answers = [], tick = null, left = SEC, startedAt = 0;
  var $ = function(id){ return document.getElementById(id); };
  var CIRC = 2 * Math.PI * 23; $('tfg').style.strokeDasharray = CIRC;
  function fmt(v){ return v.toLocaleString('cs-CZ') + ' Kč'; }
  function voc(n){ return n; }
  $('nameForm').addEventListener('submit', function(e){ e.preventDefault(); name = $('nm').value.trim().slice(0,40); if(!name) return; $('ov').classList.add('hidden'); $('who').style.display=''; $('whon').textContent = name; start(); });
  function start(){ i = 0; bank = 0; answers = []; startedAt = Date.now(); $('bankv').textContent = fmt(0); $('result').classList.add('hidden'); $('quiz').classList.remove('hidden'); show(); setTimeout(function(){ $('quiz').scrollIntoView({ behavior:'smooth', block:'center' }); }, 50); }
  function setTimer(s){ $('tsec').textContent = s; $('tfg').style.strokeDashoffset = CIRC * (1 - s / SEC); $('timer').classList.toggle('hot', s <= 5); }
  function show(){ var q = Q[i]; $('step').textContent = 'Otázka ' + (i+1) + ' z ' + Q.length; $('qtext').textContent = q.q; $('why').className = 'why'; $('next').classList.add('hidden');
    $('opts').innerHTML = q.a.map(function(t, k){ return '<button class="opt" data-k="' + k + '"><span class="k">' + 'ABC'[k] + '</span><span>' + esc(t) + '</span></button>'; }).join('');
    Array.prototype.forEach.call($('opts').querySelectorAll('.opt'), function(b){ b.addEventListener('click', function(){ answer(+b.getAttribute('data-k')); }); });
    left = SEC; setTimer(left); clearInterval(tick); tick = setInterval(function(){ left--; setTimer(Math.max(0,left)); if(left <= 0){ clearInterval(tick); answer(-1); } }, 1000); }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
  function answer(k){ clearInterval(tick); var q = Q[i]; var ok = k === q.c; answers.push({ q: i, a: k, ok: ok, t: SEC - left });
    Array.prototype.forEach.call($('opts').querySelectorAll('.opt'), function(b){ b.disabled = true; var kk = +b.getAttribute('data-k'); if(kk === q.c) b.classList.add('ok'); else if(kk === k) b.classList.add('bad'); });
    if(ok){ bank += PRIZE; $('bankv').textContent = fmt(bank); $('bank').classList.remove('pop'); void $('bank').offsetWidth; $('bank').classList.add('pop'); var f = document.createElement('div'); f.className = 'fly'; f.textContent = '+' + fmt(PRIZE); document.body.appendChild(f); setTimeout(function(){ f.remove(); }, 1400); }
    $('why').textContent = (ok ? '✓ Správně! ' : (k < 0 ? '⏱ Čas vypršel. ' : '✗ Tentokrát ne. ')) + q.why; $('why').className = 'why show';
    $('next').textContent = i + 1 < Q.length ? 'Další otázka →' : 'Vyhodnotit →'; $('next').classList.remove('hidden'); }
  $('next').addEventListener('click', function(){ i++; if(i < Q.length) show(); else finish(); });
  function finish(){ $('quiz').classList.add('hidden'); var r = $('result'); r.classList.remove('hidden'); var okN = answers.filter(function(a){ return a.ok; }).length;
    $('rbig').textContent = fmt(bank); $('rtitle').textContent = name + ', ' + (okN === Q.length ? 'bez chyby – to je výkon!' : okN >= 3 ? 'solidní základ.' : 'začátek je za vámi.');
    $('rtext').textContent = 'Správně ' + okN + ' z ' + Q.length + '. ' + (okN === Q.length ? 'S takovým přehledem je škoda nechat kapitál jen virtuální.' : 'Zbytek se dozvíte, až si prověříte své místo – aplikace spočítá, co by prádlomat vydělal právě u vás.');
    r.scrollIntoView({ behavior:'smooth', block:'center' });
    try { fetch('/api/arena/result', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ sid: SID, name: name, score: okN, bank: bank, answers: answers, ms: Date.now() - startedAt }) }); } catch(e){} }
  $('again').addEventListener('click', start);
  // ping návštěvy (stejný beacon jako ostatní veřejné stránky)
  try { fetch('/api/presence/ping', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ sid: SID, path: '/arena' }) }); } catch(e){}
})();
</script>
</body>
</html>`;

function arenaPage() {
  const LOC = require('./location'); const V = require('./views');
  const src = LOC.PAGE;
  // Hlava (meta + styly) ze stránky Prověření lokality, jen jiný titulek a popis; animované pozadí (síť) sdílené.
  let head = src.slice(0, src.indexOf('</head>'));
  head = head.replace(/<title>[^<]*<\/title>/, '<title>Aréna Best Series – vydělejte si startovní kapitál na prádlomat</title>')
    .replace(/<meta name="description" content="[^"]*"/, '<meta name="description" content="5 otázek, 15 vteřin na každou, +50 000 Kč za správnou odpověď. Zahrajte si o virtuální startovní kapitál a zjistěte, co by prádlomat vydělal u vás."');
  const ni = src.indexOf("(function(){var c=document.getElementById('net')"); const ne = src.indexOf('\n', ni);
  const netScript = ni >= 0 ? src.slice(ni, ne) : '';
  const hi = src.indexOf('<header'); const he = src.indexOf('</header>') + '</header>'.length;
  let header = src.slice(hi, he).replace('Prověření lokality</span>', 'Aréna</span>').replace('<!--PRESENCE-->', '<span style="margin-left:auto"></span>' + V.PRESENCE_HTML);
  return PAGE(head + '<style>' + V.PRESENCE_CSS + '</style>', netScript, header).replace('</body>', '<script>' + V.PRESENCE_JS + '</script></body>');
}

module.exports = { arenaPage, QUESTIONS, PRIZE, SECONDS };
