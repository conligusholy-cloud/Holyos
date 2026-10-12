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
var act=0,lastAct=Date.now(),pend=0,maxScroll=0,sentScroll=0;
function touch(){lastAct=Date.now();}
['mousemove','keydown','touchstart','scroll','click'].forEach(function(n){addEventListener(n,touch,{passive:true});});
addEventListener('scroll',function(){var h=document.documentElement;var p=Math.round((h.scrollTop+innerHeight)/Math.max(h.scrollHeight,1)*100);if(p>maxScroll)maxScroll=Math.min(p,100);},{passive:true});
setInterval(function(){if(document.visibilityState==='visible'&&Date.now()-lastAct<30000)pend+=5;if(pend>=20){send({type:'time',meta:{secs:pend}});pend=0;}},5000);
function flush(){if(pend>0){send({type:'time',meta:{secs:pend}});pend=0;}if(maxScroll>sentScroll){send({type:'scroll',meta:{pct:maxScroll}});sentScroll=maxScroll;}}
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')flush();});addEventListener('pagehide',flush);
try{if('IntersectionObserver' in window){var seen={},n=0;var io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting&&en.intersectionRatio>=.6){var el=en.target;var s=(el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,70);if(s&&!seen[s]&&n<40){seen[s]=1;n++;setTimeout(function(){if(seen[s]===1){seen[s]=2;send({type:'section',label:s});}},1500);}}});},{threshold:[.6]});document.querySelectorAll('main h1,main h2,main h3,.vh-step b,.card>h2,.card>h3').forEach(function(h){io.observe(h);});}}catch(e){}
})();`;

module.exports = { TRACK_JS };
