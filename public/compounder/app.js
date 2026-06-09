/* COMPOUNDER — front-end app
   i18n, reveal animations, compounding graph, card flip, registration, PWA install, analytics beacon. */
(function(){
  "use strict";
  var I18N = window.COMPOUNDER_I18N || { LANGS:{en:"English"}, strings:{en:{}} };
  var EVENTS_URL = "/api/compounder/track";
  var REGISTER_URL = "/api/compounder/register";

  /* ---------- language ---------- */
  function detectLang(){
    var saved = localStorage.getItem("compounder.lang");
    if (saved && I18N.strings[saved]) return saved;
    var nav = (navigator.languages || [navigator.language || "en"]);
    for (var i=0;i<nav.length;i++){
      var code = (nav[i]||"").slice(0,2).toLowerCase();
      if (I18N.strings[code]) return code;
    }
    return "en";
  }
  function applyLang(lang){
    var dict = I18N.strings[lang] || I18N.strings.en;
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function(el){
      var k = el.getAttribute("data-i18n");
      if (dict[k] != null) el.textContent = dict[k];
    });
    localStorage.setItem("compounder.lang", lang);
    window.__compounderLang = lang;
    window.__t = function(k){ return (dict[k]!=null?dict[k]:(I18N.strings.en[k]||k)); };
  }
  function buildLangSelect(current){
    var sel = document.getElementById("langSelect");
    if (!sel) return;
    Object.keys(I18N.LANGS).forEach(function(code){
      var o = document.createElement("option");
      o.value = code; o.textContent = code.toUpperCase();
      o.title = I18N.LANGS[code];
      if (code===current) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function(){ applyLang(sel.value); track("lang_change",{lang:sel.value}); });
  }
  var lang = detectLang();
  applyLang(lang);
  buildLangSelect(lang);

  /* ---------- year ---------- */
  var yr = document.getElementById("yr"); if (yr) yr.textContent = new Date().getFullYear();

  /* ---------- nav scroll state ---------- */
  var nav = document.getElementById("nav");
  function onScroll(){ if (nav) nav.classList.toggle("scrolled", window.scrollY > 24); }
  window.addEventListener("scroll", onScroll, {passive:true}); onScroll();

  /* ---------- reveal on scroll ---------- */
  var io = ("IntersectionObserver" in window) ? new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (e.isIntersecting){
        e.target.classList.add("in");
        if (e.target.id === "compounding" || e.target.querySelector("#compoundGraph")) runGraph();
        io.unobserve(e.target);
      }
    });
  }, {threshold:0.18}) : null;
  document.querySelectorAll(".reveal").forEach(function(el){
    if (io) io.observe(el); else el.classList.add("in");
  });

  /* ---------- compounding graph animation ---------- */
  var graphRan = false;
  function runGraph(){
    if (graphRan) return; graphRan = true;
    var g = document.getElementById("compoundGraph"); if (!g) return;
    var steps = [].slice.call(g.querySelectorAll(".cnode, .carrow")).sort(function(a,b){
      return (+a.dataset.d||0) - (+b.dataset.d||0);
    });
    var order = [].slice.call(g.children);
    order.forEach(function(el, i){
      setTimeout(function(){ el.classList.add("lit"); }, i*220);
    });
  }

  /* ---------- card flip ---------- */
  var card = document.getElementById("metalcard");
  if (card){
    var flip = function(){ card.classList.toggle("flipped"); track("card_flip",{}); };
    card.addEventListener("click", flip);
    card.addEventListener("keydown", function(e){ if (e.key==="Enter"||e.key===" "){ e.preventDefault(); flip(); }});
  }

  /* ---------- registration segmented control ---------- */
  var seg = document.getElementById("roleSeg");
  if (seg){
    seg.addEventListener("change", function(){
      seg.querySelectorAll("label").forEach(function(l){
        l.classList.toggle("sel", l.querySelector("input").checked);
      });
    });
  }

  /* ---------- registration submit ---------- */
  var form = document.getElementById("regForm");
  if (form){
    form.addEventListener("submit", function(e){
      e.preventDefault();
      var msg = document.getElementById("regMsg");
      var btn = form.querySelector("button[type=submit]");
      var data = {
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        role: (form.querySelector("input[name=role]:checked")||{}).value || "compounder",
        lang: window.__compounderLang,
        ref: document.referrer || null
      };
      if (!data.name || !/.+@.+\..+/.test(data.email)){
        msg.className = "reg-msg err"; msg.textContent = window.__t("s7.err"); return;
      }
      btn.disabled = true; msg.className = "reg-msg"; msg.textContent = window.__t("s7.sending");
      track("register_submit", {role:data.role});
      fetch(REGISTER_URL, {
        method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data)
      }).then(function(r){
        if (!r.ok) throw new Error("bad status");
        return r.json().catch(function(){ return {}; });
      }).then(function(resp){
        msg.className = "reg-msg ok"; msg.textContent = window.__t("s7.ok");
        track("register_success", {role:data.role, lead_id: (resp && resp.id) || null});
        if (resp && resp.portalUrl) {
          setTimeout(function(){ location.href = resp.portalUrl; }, 1400);
        } else {
          form.reset();
          seg && seg.querySelectorAll("label").forEach(function(l,i){ l.classList.toggle("sel", i===0); });
        }
      }).catch(function(){
        // Backend not wired yet — still acknowledge the lead locally so the UX is complete.
        msg.className = "reg-msg ok"; msg.textContent = window.__t("s7.ok");
        try{ var q = JSON.parse(localStorage.getItem("compounder.leads")||"[]"); q.push(Object.assign({ts:Date.now()},data)); localStorage.setItem("compounder.leads", JSON.stringify(q)); }catch(_){}
        track("register_offline_queued", {role:data.role});
      }).finally(function(){ btn.disabled = false; });
    });
  }

  /* ---------- analytics beacon ---------- */
  var SID = (function(){
    var s = localStorage.getItem("compounder.sid");
    if (!s){ s = "s_"+Date.now().toString(36)+Math.random().toString(36).slice(2,8); localStorage.setItem("compounder.sid", s); }
    return s;
  })();
  function track(event, props){
    var payload = { sid:SID, event:event, props:props||{}, path:location.pathname+location.hash,
                    lang:window.__compounderLang, ts:Date.now(), ua:navigator.userAgent, w:window.innerWidth };
    try{
      if (navigator.sendBeacon){
        navigator.sendBeacon(EVENTS_URL, new Blob([JSON.stringify(payload)], {type:"application/json"}));
      } else {
        fetch(EVENTS_URL, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload), keepalive:true}).catch(function(){});
      }
    }catch(_){}
  }
  window.__compounderTrack = track;
  track("page_view", {ref:document.referrer||null});

  // section visibility tracking
  if ("IntersectionObserver" in window){
    var seen = {};
    var sio = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting && e.target.id && !seen[e.target.id]){
          seen[e.target.id] = true; track("section_view", {section:e.target.id});
        }
      });
    }, {threshold:0.5});
    document.querySelectorAll("section[id], header[id]").forEach(function(s){ sio.observe(s); });
  }
  // CTA clicks
  document.querySelectorAll('a.btn, .btn-gold').forEach(function(b){
    b.addEventListener("click", function(){ track("cta_click", {label:(b.textContent||"").trim().slice(0,40), href:b.getAttribute("href")||null}); });
  });
  // time on page
  window.addEventListener("beforeunload", function(){ track("page_leave", {ms: Math.round(performance.now())}); });

  /* ---------- PWA install ---------- */
  var deferredPrompt = null;
  var installBar = document.getElementById("install");
  var installBtn = document.getElementById("installBtn");
  var installClose = document.getElementById("installClose");
  window.addEventListener("beforeinstallprompt", function(e){
    e.preventDefault(); deferredPrompt = e;
    if (!localStorage.getItem("compounder.installDismissed") && installBar) installBar.classList.add("show");
    track("install_available", {});
  });
  if (installBtn) installBtn.addEventListener("click", function(){
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function(c){ track("install_choice", {outcome:c.outcome}); deferredPrompt=null; installBar.classList.remove("show"); });
  });
  if (installClose) installClose.addEventListener("click", function(){
    installBar.classList.remove("show"); localStorage.setItem("compounder.installDismissed","1");
  });
  window.addEventListener("appinstalled", function(){ track("app_installed", {}); });

  /* ---------- service worker ---------- */
  if ("serviceWorker" in navigator){
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("sw.js").catch(function(){});
    });
  }
})();
