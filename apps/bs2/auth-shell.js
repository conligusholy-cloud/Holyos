// BS2 — prémiová přihlašovací obrazovka (Best Series 2.0): samostatná šablona bez hlavičky aplikace.
// Vizuál: tmavé pozadí, animovaná síť uzlů (canvas), jemný perspektivní grid, skleněná karta se svítícím okrajem.

const { logoSvg } = require('./logo');

const AUTH_CSS = `
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}html{-webkit-text-size-adjust:100%}
:root{--bg:#04060c;--ink:#eaf2ff;--ink2:#8ea2c2;--ink3:#58698a;--line:rgba(120,160,255,.14);--acc:#1e86e0;--acc2:#4fd1ff;--vio:#7c5cff;--err:#ff5d6c;--ok:#2fe3a0}
body{margin:0;min-height:100vh;min-height:100dvh;background:var(--bg);color:var(--ink);font:15px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow-x:hidden}
#net{position:fixed;inset:0;width:100%;height:100%;z-index:0}
.glow{position:fixed;border-radius:50%;filter:blur(90px);opacity:.55;z-index:0;pointer-events:none;animation:drift 18s ease-in-out infinite alternate}
.glow.a{width:620px;height:620px;left:-180px;top:-160px;background:radial-gradient(circle,rgba(30,134,224,.65),transparent 65%)}
.glow.b{width:560px;height:560px;right:-160px;bottom:-200px;background:radial-gradient(circle,rgba(124,92,255,.55),transparent 65%);animation-delay:-9s}
.glow.c{width:380px;height:380px;left:45%;top:55%;background:radial-gradient(circle,rgba(79,209,255,.35),transparent 65%);animation-delay:-4s}
@keyframes drift{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(60px,40px,0) scale(1.12)}}
.grid{position:fixed;inset:auto 0 0 0;height:46vh;z-index:0;pointer-events:none;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:64px 64px;transform:perspective(600px) rotateX(62deg);transform-origin:top;mask-image:linear-gradient(to bottom,transparent,#000 35%,#000 70%,transparent);-webkit-mask-image:linear-gradient(to bottom,transparent,#000 35%,#000 70%,transparent)}
.wrap{position:relative;z-index:1;min-height:100vh;min-height:100dvh;display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);max-width:1180px;margin:0 auto;padding:0 28px}
.hero{display:flex;flex-direction:column;justify-content:center;padding:60px 36px 60px 0}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:46px}
.mark{display:inline-flex;filter:drop-shadow(0 10px 28px rgba(30,134,224,.5))}
.brand b{font-size:16px;letter-spacing:.02em}.brand b span{background:linear-gradient(90deg,var(--acc2),var(--vio));-webkit-background-clip:text;background-clip:text;color:transparent}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink2);border:1px solid var(--line);border-radius:999px;padding:6px 12px;width:max-content;background:rgba(255,255,255,.02)}
.eyebrow i{width:6px;height:6px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 0 rgba(47,227,160,.7);animation:pulse 2s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(47,227,160,.7)}70%{box-shadow:0 0 0 9px rgba(47,227,160,0)}100%{box-shadow:0 0 0 0 rgba(47,227,160,0)}}
h1{margin:22px 0 14px;font-size:clamp(34px,4.6vw,56px);line-height:1.04;letter-spacing:-.025em;font-weight:800}
h1 .g{background:linear-gradient(90deg,#fff 0%,var(--acc2) 45%,var(--vio) 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.lead{margin:0;max-width:480px;color:var(--ink2);font-size:16px;line-height:1.65}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:26px}.chips span{font-size:12px;color:var(--ink2);border:1px solid var(--line);background:rgba(10,16,30,.55);backdrop-filter:blur(8px);border-radius:10px;padding:7px 11px}
.stats{display:flex;gap:30px;margin-top:38px}.stats div b{display:block;font-size:26px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}.stats div small{color:var(--ink3);font-size:12px}
.side{display:flex;align-items:center;justify-content:center;padding:50px 0}
.card{position:relative;width:100%;max-width:440px;border-radius:22px;padding:1px;background:conic-gradient(from var(--a,0deg),transparent 0 70%,rgba(79,209,255,.9) 82%,rgba(124,92,255,.9) 90%,transparent 100%);animation:spin 6s linear infinite}
@property --a{syntax:'<angle>';inherits:false;initial-value:0deg}
@keyframes spin{to{--a:360deg}}
.card::before{content:"";position:absolute;inset:0;border-radius:22px;background:rgba(120,160,255,.14)}
.in{position:relative;border-radius:21px;background:linear-gradient(180deg,rgba(14,22,40,.92),rgba(7,11,22,.95));backdrop-filter:blur(18px);padding:30px 28px 24px;box-shadow:0 30px 80px rgba(0,0,0,.55)}
.in h2{margin:0 0 4px;font-size:22px;letter-spacing:-.01em}.in .sub{margin:0 0 22px;color:var(--ink2);font-size:13px}
label{display:flex;justify-content:space-between;align-items:baseline;font-size:12px;color:var(--ink2);margin:14px 0 6px;letter-spacing:.02em}label a{color:var(--acc2);text-decoration:none;font-size:12px}label a:hover{text-decoration:underline}
.f{position:relative;display:flex;align-items:center;background:rgba(4,8,16,.8);border:1px solid rgba(120,160,255,.18);border-radius:12px;height:48px;transition:border-color .2s,box-shadow .2s}
.f:focus-within{border-color:var(--acc2);box-shadow:0 0 0 4px rgba(79,209,255,.12),0 0 24px rgba(79,209,255,.18)}
.f svg{width:18px;height:18px;margin:0 0 0 14px;color:var(--ink3);flex:none}
.f input{flex:1;min-width:0;height:100%;background:transparent;border:0;outline:0;color:var(--ink);font:inherit;font-size:16px;padding:0 12px}
.f input:-webkit-autofill{-webkit-text-fill-color:var(--ink);box-shadow:0 0 0 1000px #070c18 inset}
.f button{background:transparent;border:0;color:var(--ink3);cursor:pointer;height:100%;padding:0 12px;display:grid;place-items:center}.f button:hover{color:var(--ink)}
.btn{position:relative;overflow:hidden;width:100%;margin-top:22px;height:50px;border:0;border-radius:13px;font:inherit;font-size:15px;font-weight:700;color:#fff;cursor:pointer;background:linear-gradient(90deg,var(--acc),#3a6cf5 55%,var(--vio));box-shadow:0 12px 34px rgba(58,108,245,.45);display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:transform .15s,box-shadow .15s}
.btn:hover{transform:translateY(-1px);box-shadow:0 16px 40px rgba(58,108,245,.6)}.btn:active{transform:translateY(0)}
.btn::after{content:"";position:absolute;top:0;left:-70%;width:40%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent);transform:skewX(-20deg);animation:shine 3.2s ease-in-out infinite}
@keyframes shine{0%,60%{left:-70%}100%{left:130%}}
.msg{padding:10px 12px;border-radius:10px;margin:0 0 6px;font-size:13.5px;line-height:1.4}.msg.err{background:rgba(255,93,108,.1);border:1px solid rgba(255,93,108,.4);color:#ffb3bb}.msg.ok{background:rgba(47,227,160,.1);border:1px solid rgba(47,227,160,.4);color:#a9f5d9}
.foot{margin:18px 0 0;text-align:center;color:var(--ink3);font-size:11.5px}.foot a{color:var(--ink2);text-decoration:none}.foot a:hover{color:var(--ink)}
.sec{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:14px;color:var(--ink3);font-size:11.5px;letter-spacing:.06em;text-transform:uppercase}.sec svg{width:14px;height:14px}
.copy{position:relative;z-index:1;text-align:center;color:var(--ink3);font-size:12px;padding:0 20px 22px}
.hint{display:block;font-size:12px;color:var(--ink3);margin-top:6px}
@media (max-width:860px){.wrap{grid-template-columns:1fr;padding:0 18px}.hero{padding:40px 0 10px}.brand{margin-bottom:28px}h1{font-size:34px}.stats{gap:22px;margin-top:26px}.stats div b{font-size:22px}.side{padding:22px 0 40px}.in{padding:26px 20px 20px}.grid{display:none}}
@media (prefers-reduced-motion:reduce){.card,.glow,.btn::after,.eyebrow i{animation:none}}
`;

const AUTH_JS = `
(function(){var c=document.getElementById('net');if(!c)return;var x=c.getContext('2d'),w,h,P=[],N=70,R=150,dpr=Math.min(2,window.devicePixelRatio||1),mx=-1e4,my=-1e4;
function size(){w=c.clientWidth;h=c.clientHeight;c.width=w*dpr;c.height=h*dpr;x.setTransform(dpr,0,0,dpr,0,0);N=Math.max(34,Math.min(90,Math.round(w*h/16000)));P=[];for(var i=0;i<N;i++)P.push({x:Math.random()*w,y:Math.random()*h,vx:(Math.random()-.5)*.35,vy:(Math.random()-.5)*.35,r:Math.random()*1.6+.6})}
window.addEventListener('resize',size);size();
window.addEventListener('pointermove',function(e){mx=e.clientX;my=e.clientY},{passive:true});
var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function step(){x.clearRect(0,0,w,h);for(var i=0;i<P.length;i++){var p=P[i];if(!reduce){p.x+=p.vx;p.y+=p.vy;var dx=p.x-mx,dy=p.y-my,d=Math.hypot(dx,dy);if(d<140){p.x+=dx/d*.6;p.y+=dy/d*.6}}
if(p.x<0||p.x>w)p.vx*=-1;if(p.y<0||p.y>h)p.vy*=-1;}
for(var i=0;i<P.length;i++){for(var j=i+1;j<P.length;j++){var a=P[i],b=P[j],dd=Math.hypot(a.x-b.x,a.y-b.y);if(dd<R){x.globalAlpha=(1-dd/R)*.35;x.strokeStyle='#4fa3ff';x.lineWidth=1;x.beginPath();x.moveTo(a.x,a.y);x.lineTo(b.x,b.y);x.stroke()}}}
x.globalAlpha=1;for(var i=0;i<P.length;i++){var p=P[i];x.fillStyle='#8fd0ff';x.beginPath();x.arc(p.x,p.y,p.r,0,6.283);x.fill()}
if(!reduce)requestAnimationFrame(step)}step();
document.querySelectorAll('[data-eye]').forEach(function(b){b.addEventListener('click',function(){var i=b.parentNode.querySelector('input');i.type=i.type==='password'?'text':'password';b.setAttribute('aria-label',i.type==='password'?'Zobrazit heslo':'Skrýt heslo')})});
})();`;

const ICON = {
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

function fmtN(n) { return Number(n || 0).toLocaleString('cs-CZ'); }

/** Společná obálka: hero vlevo + karta vpravo. `card` = vnitřní HTML karty. */
function authShell({ title, card, members = null, esc }) {
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#04060c">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} · Best Series 2.0</title><link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>${AUTH_CSS}</style></head><body>
<canvas id="net" aria-hidden="true"></canvas><div class="glow a"></div><div class="glow b"></div><div class="glow c"></div><div class="grid" aria-hidden="true"></div>
<div class="wrap">
  <section class="hero">
    <div class="brand"><div class="mark">${logoSvg(44, 'a')}</div><b>Best Series <span>2.0</span></b></div>
    <div class="eyebrow"><i></i>Platforma nové generace · online</div>
    <h1><span class="g">Vítej zpět</span><br>v komunitě podporovatelů</h1>
    <p class="lead">Jeden účet, všechny výhody. Přihlas se svým nickem nebo e-mailem jako dřív — zbytek je nový.</p>
    <div class="chips"><span>Šifrované připojení</span><span>Přístup z mobilu i počítače</span><span>Výhody pro členy</span></div>
    ${members != null ? `<div class="stats"><div><b>${fmtN(members)}</b><small>aktivních členů</small></div><div><b>od 2014</b><small>s vámi</small></div></div>` : ''}
  </section>
  <section class="side"><div class="card"><div class="in">${card}</div></div></section>
</div>
<p class="copy">© ${new Date().getFullYear()} Best Series s.r.o. · bestseries2.cz</p>
<script>${AUTH_JS}</script></body></html>`;
}

module.exports = { authShell, ICON, AUTH_JS };
