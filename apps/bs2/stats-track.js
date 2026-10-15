// BS2 — klientský sledovací skript (vkládá se do stránek přihlášeného uživatele)
'use strict';
// Klientský skript — vkládá se na stránky přihlášeného uživatele. Nesbírá obsah polí (hesla, texty), jen názvy ovládacích prvků.
const TRACK_JS = `(function(){
if(window.__bs2t)return;window.__bs2t=1;
var sid;try{sid=sessionStorage.getItem('bs2sid');if(!sid){sid=Math.random().toString(36).slice(2)+Date.now().toString(36);sessionStorage.setItem('bs2sid',sid);}}catch(e){sid=String(Date.now());}
var path=location.pathname;
function send(o){o.sid=sid;o.path=path;var b=JSON.stringify(o);try{if(navigator.sendBeacon){navigator.sendBeacon('/api/track',new Blob([b],{type:'application/json'}));}else{fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:b,keepalive:true,credentials:'same-origin'});}}catch(e){}}
function txt(el){var s=(el.getAttribute('data-track')||el.getAttribute('aria-label')||el.getAttribute('title')||'');if(!s&&/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)){s=(el.type==='submit'||el.type==='button')?(el.value||''):(el.name||el.id||el.placeholder||'');}if(!s)s=(el.innerText||el.textContent||'');s=s.replace(/\\s+/g,' ').trim();if(!s)s=el.id||el.className&&String(el.className).split(' ')[0]||el.tagName;return s.slice(0,80);}
send({type:'pageview',meta:{ref:document.referrer?new URL(document.referrer).pathname:'',w:innerWidth,h:innerHeight,t:document.title.slice(0,80)}});
document.addEventListener('click',function(e){var el=e.target&&e.target.closest?e.target.closest('a,button,summary,select,input,label,[role=button],[data-track]'):null;var tgt=el||e.target;if(!tgt||!tgt.tagName)return;var dh=Math.max(document.documentElement.scrollHeight,1);var m={tag:tgt.tagName.toLowerCase(),x:Math.round(e.clientX/Math.max(innerWidth,1)*100),y:Math.round((e.pageY||0)/dh*100)};var h=tgt.getAttribute&&tgt.getAttribute('href');if(h)m.href=h.slice(0,120);if(tgt.id)m.id=tgt.id.slice(0,40);send({type:'click',label:txt(tgt),meta:m});},true);
document.addEventListener('change',function(e){var t=e.target;if(!t||!t.tagName)return;var tp=t.type;if(tp==='password'||tp==='email'||tp==='tel'||tp==='text'||t.tagName==='TEXTAREA')return;var v='';if(tp==='range')v=t.value;else if(tp==='checkbox'||tp==='radio')v=t.checked?'1':'0';else if(t.tagName==='SELECT')v=(t.options[t.selectedIndex]||{}).text||'';send({type:'interact',label:(t.name||t.id||tp||t.tagName),meta:{v:String(v).slice(0,40)}});},true);
var sl=null;document.addEventListener('input',function(e){var t=e.target;if(!t||t.type!=='range')return;clearTimeout(sl);sl=setTimeout(function(){send({type:'interact',label:t.name||t.id||'range',meta:{v:t.value}});},700);},true);
setInterval(function(){if(document.visibilityState==='visible')send({type:'ping'});},30000);
var act=0,lastAct=Date.now(),pend=0,maxScroll=0,sentScroll=0;
function touch(){lastAct=Date.now();}
['mousemove','keydown','touchstart','scroll','click'].forEach(function(n){addEventListener(n,touch,{passive:true});});
addEventListener('scroll',function(){var h=document.documentElement;var p=Math.round((h.scrollTop+innerHeight)/Math.max(h.scrollHeight,1)*100);if(p>maxScroll)maxScroll=Math.min(p,100);},{passive:true});
setInterval(function(){if(document.visibilityState==='visible'&&Date.now()-lastAct<30000)pend+=5;if(pend>=20){send({type:'time',meta:{secs:pend}});pend=0;}},5000);
function flush(){if(pend>0){send({type:'time',meta:{secs:pend}});pend=0;}if(maxScroll>sentScroll){send({type:'scroll',meta:{pct:maxScroll}});sentScroll=maxScroll;}}
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')flush();});addEventListener('pagehide',flush);
try{if('IntersectionObserver' in window){var seen={},n=0;var io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting&&en.intersectionRatio>=.6){var el=en.target;var s=(el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,70);if(s&&!seen[s]&&n<40){seen[s]=1;n++;setTimeout(function(){if(seen[s]===1){seen[s]=2;send({type:'section',label:s});}},1500);}}});},{threshold:[.6]});document.querySelectorAll('main h1,main h2,main h3,.vh-step b,.card>h2,.card>h3').forEach(function(h){io.observe(h);});}}catch(e){}
})();`;


// ── Veřejný sledovací skript pro záchytné stránky (bez přihlášení). Anonymní sid, žádný obsah polí.
//    Sbírá: zobrazení, scroll hloubku, viděné sekce + čas strávený na sekci (co čtou), kliky (text prvku),
//    pohyb myši jako teplotní mřížku 20×N (kde se zdržuje kurzor), celkový čas a sekci, u které odešel.
const PUB_TRACK_JS = `(function(){
if(window.__bs2pt)return;window.__bs2pt=1;
var sid;try{sid=sessionStorage.getItem('misto_sid');if(!sid){sid=Math.random().toString(36).slice(2)+Date.now().toString(36);sessionStorage.setItem('misto_sid',sid);}}catch(e){sid='x'+Date.now();}
var path=location.pathname.replace(/\\/+$/,'')||'/';var Q=[];var t0=Date.now();
function push(o){o.t=Date.now()-t0;Q.push(o);if(Q.length>=25)flush();}
function flush(){if(!Q.length)return;var b=JSON.stringify({sid:sid,path:path,ev:Q.splice(0,Q.length),w:innerWidth,h:innerHeight});try{if(navigator.sendBeacon){navigator.sendBeacon('/api/public/track',new Blob([b],{type:'application/json'}));}else{fetch('/api/public/track',{method:'POST',headers:{'Content-Type':'application/json'},body:b,keepalive:true});}}catch(e){}}
function secName(el){var s=el.closest&&el.closest('section,[data-sec],header,footer');if(!s)return '';return s.getAttribute('data-sec')||s.id||(s.querySelector('h1,h2,h3')?(s.querySelector('h1,h2,h3').textContent||'').replace(/\\s+/g,' ').trim().slice(0,50):s.tagName.toLowerCase());}
var UA=navigator.userAgent;var BR=/Edg\\//.test(UA)?'edge':/OPR\\//.test(UA)?'opera':/Chrome\\//.test(UA)?'chrome':/Firefox\\//.test(UA)?'firefox':/Safari\\//.test(UA)?'safari':'jiny';
push({k:'view',m:{ref:document.referrer?document.referrer.slice(0,120):'',q:location.search.slice(0,240),ua:/Mobi|Android|iPhone|iPad/i.test(UA)?'m':'d',w:innerWidth,h:innerHeight,dpr:Math.round((window.devicePixelRatio||1)*10)/10,lang:(navigator.language||'').slice(0,8),conn:(navigator.connection&&navigator.connection.effectiveType)||'',br:BR}});
/* scroll hloubka po 25 % */
var maxS=0,mark={};addEventListener('scroll',function(){var h=document.documentElement;var p=Math.round((h.scrollTop+innerHeight)/Math.max(h.scrollHeight,1)*100);if(p>maxS)maxS=Math.min(p,100);[25,50,75,100].forEach(function(m){if(maxS>=m&&!mark[m]){mark[m]=1;push({k:'scroll',l:String(m)});}});},{passive:true});
/* sekce: viděná (60 % + 1 s) a čas, po který je ve viewportu (co čtou) */
var secs=[];document.querySelectorAll('section,[data-sec]').forEach(function(s){var nm=s.getAttribute('data-sec')||s.id||(s.querySelector('h1,h2,h3')?(s.querySelector('h1,h2,h3').textContent||'').replace(/\\s+/g,' ').trim().slice(0,50):'');if(nm)secs.push({el:s,nm:nm,vis:false,since:0,acc:0,seen:false});});
var cur='';
if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){var now=Date.now();es.forEach(function(en){var o=null;for(var i=0;i<secs.length;i++)if(secs[i].el===en.target)o=secs[i];if(!o)return;if(en.isIntersecting&&en.intersectionRatio>=.4){if(!o.vis){o.vis=true;o.since=now;}cur=o.nm;if(!o.seen){o.seen=true;setTimeout(function(){if(o.vis)push({k:'section',l:o.nm});},1000);}}else if(o.vis){o.vis=false;o.acc+=now-o.since;}});},{threshold:[.4,.6]});secs.forEach(function(o){io.observe(o.el);});}
/* kliky */
document.addEventListener('click',function(e){var el=e.target&&e.target.closest?e.target.closest('a,button,summary,[role=button],[data-cta],input[type=submit]'):null;if(!el)return;var s=(el.getAttribute('data-cta')||el.getAttribute('aria-label')||el.innerText||el.textContent||el.value||'').replace(/\\s+/g,' ').trim().slice(0,60);push({k:'click',l:s||el.tagName.toLowerCase(),m:{sec:secName(el),href:(el.getAttribute('href')||'').slice(0,80)}});},true);
/* pohyb myši: mřížka 20 sloupců × řádky po 5 % výšky dokumentu, vzorek každých 400 ms */
var grid={},lastMv=0;addEventListener('mousemove',function(e){var now=Date.now();if(now-lastMv<400)return;lastMv=now;var dh=Math.max(document.documentElement.scrollHeight,1);var cx=Math.min(19,Math.floor(e.clientX/Math.max(innerWidth,1)*20)),cy=Math.min(99,Math.floor((e.pageY||0)/dh*100/5)*5);var k=cx+','+cy;grid[k]=(grid[k]||0)+1;},{passive:true});
/* aktivita (čas) */
var lastAct=Date.now(),active=0;['mousemove','keydown','touchstart','scroll','click'].forEach(function(n){addEventListener(n,function(){lastAct=Date.now();},{passive:true});});
setInterval(function(){if(document.visibilityState==='visible'&&Date.now()-lastAct<30000)active+=5;},5000);
function dump(final){var now=Date.now();var d=[];secs.forEach(function(o){var a=o.acc+(o.vis?now-o.since:0);if(a>=1500){d.push({l:o.nm,s:Math.round(a/1000)});o.acc=0;o.since=now;}});if(d.length)push({k:'dwell',m:{secs:d}});var g=Object.keys(grid);if(g.length){push({k:'mouse',m:{g:grid}});grid={};}if(active>0){push({k:'time',m:{s:active}});active=0;}if(final)push({k:'exit',l:cur,m:{scroll:maxS}});flush();}
setInterval(function(){dump(false);},10000);
/* heartbeat pro živý přehled: stránka je otevřená a viditelná (aktuální sekce + scroll) */
setInterval(function(){if(document.visibilityState==='visible')push({k:'ping',l:cur,m:{s:maxS}});},15000);
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')dump(true);});addEventListener('pagehide',function(){dump(true);});
/* výkon stránky: načtení, FCP, LCP, CLS */
var lcp=0,cls=0;try{new PerformanceObserver(function(l){var e=l.getEntries();var x=e[e.length-1];if(x)lcp=Math.round(x.startTime);}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(!e.hadRecentInput)cls+=e.value;});}).observe({type:'layout-shift',buffered:true});}catch(e){}
addEventListener('load',function(){setTimeout(function(){var m={};try{var n=performance.getEntriesByType('navigation')[0];if(n){m.ttfb=Math.round(n.responseStart);m.load=Math.round(n.loadEventEnd||performance.now());}var f=performance.getEntriesByName('first-contentful-paint')[0];if(f)m.fcp=Math.round(f.startTime);}catch(e){}m.lcp=lcp;m.cls=Math.round(cls*1000)/1000;push({k:'custom',l:'perf',m:m});},3500);});
/* zmatené chování: opakované klikání (rage) a klik na prvek, který není klikací (dead) */
var rc=[],rageT=0,deadN=0;document.addEventListener('click',function(e){var el=e.target;if(!el||!el.closest||el.closest('[data-nt]'))return;var now=Date.now();rc.push({t:now,x:e.clientX,y:e.clientY});rc=rc.filter(function(r){return now-r.t<1500;});
var near=rc.filter(function(r){return Math.abs(r.x-e.clientX)<40&&Math.abs(r.y-e.clientY)<40;});var txt=(el.innerText||el.alt||'').replace(/\\s+/g,' ').trim().slice(0,40);
if(near.length>=3&&now-rageT>3000){rageT=now;push({k:'custom',l:'rage_click',m:{sec:secName(el),el:(el.tagName||'').toLowerCase(),txt:txt}});}
var inter=el.closest('a,button,summary,input,select,textarea,label,[role=button],[data-cta],[onclick],video,iframe');if(!inter&&deadN<12){deadN++;push({k:'custom',l:'dead_click',m:{sec:secName(el),el:(el.tagName||'').toLowerCase(),txt:txt}});}},true);
/* formuláře po polích – jen název pole, nikdy obsah */
var fstart={},flast='',fsub=false,ferr={},fabd=false;
function fname(el){return String(el.getAttribute('name')||el.id||el.getAttribute('aria-label')||el.type||el.tagName).slice(0,40);}
document.addEventListener('focusin',function(e){var el=e.target;if(!el||!el.tagName||!/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)||el.type==='password'||el.type==='hidden'||(el.closest&&el.closest('[data-nt]')))return;var n=fname(el);flast=n;if(!fstart[n]){fstart[n]=1;push({k:'custom',l:'field_focus',m:{f:n,sec:secName(el)}});}},true);
document.addEventListener('invalid',function(e){var el=e.target;if(!el||!el.tagName)return;var n=fname(el);if(ferr[n])return;ferr[n]=1;push({k:'custom',l:'field_error',m:{f:n}});},true);
document.addEventListener('submit',function(e){if(e.target&&e.target.closest&&e.target.closest('[data-nt]'))return;fsub=true;push({k:'custom',l:'form_submit'});},true);
addEventListener('pagehide',function(){if(!fsub&&!fabd&&Object.keys(fstart).length){fabd=true;push({k:'custom',l:'form_abandon',m:{last:flast,n:Object.keys(fstart).length}});}});
/* interakce s prvky mimo formulář (posuvníky, volby u kalkulačky / animace) */
var itc={};document.addEventListener('input',function(e){var el=e.target;if(!el||!el.tagName||!/^(INPUT|SELECT)$/.test(el.tagName)||(el.closest&&(el.closest('form')||el.closest('[data-nt]'))))return;var n=fname(el);itc[n]=(itc[n]||0)+1;if(itc[n]===1)push({k:'custom',l:'interact',m:{f:n,sec:secName(el)}});},true);
window.__bs2track=function(l,m){push({k:'custom',l:String(l||'').slice(0,60),m:m||null});};
})();`;

module.exports = { TRACK_JS, PUB_TRACK_JS };
