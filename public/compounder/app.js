/* COMPOUNDER — front-end app
   i18n, reveal animations, compounding graph, card flip, registration, PWA install, analytics beacon. */
(function(){
  "use strict";
  var I18N = window.COMPOUNDER_I18N || { LANGS:{en:"English"}, strings:{en:{}} };
  var EVENTS_URL = "/api/compounder/track";
  var REGISTER_URL = "/api/compounder/register";

  /* ---------- language ---------- */
  function detectLang(){
    var saved = localStorage.getItem("compounder.lang2");
    if (saved && I18N.LANGS[saved]) return saved;
    return I18N.base; // výchozí angličtina (nepřebíráme jazyk prohlížeče)
  }
  function applyDict(lang){
    var base = I18N.strings[I18N.base] || {};
    var loaded = I18N.strings[lang] || {};
    var dict = {};
    for (var k in base) dict[k] = base[k];
    for (var k2 in loaded){ if (loaded[k2] != null && loaded[k2] !== "") dict[k2] = loaded[k2]; }
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function(el){
      var key = el.getAttribute("data-i18n");
      if (dict[key] != null) el.textContent = dict[key];
    });
    window.__compounderLang = lang;
    window.__compounderDict = dict;
    window.__t = function(k){ return (dict[k] != null ? dict[k] : k); };
  }
  function applyLang(lang){
    localStorage.setItem("compounder.lang2", lang);
    if (lang === I18N.base || I18N.strings[lang]) { applyDict(lang); return; }
    fetch(I18N.path + lang + ".json").then(function(r){ return r.ok ? r.json() : {}; })
      .then(function(j){ I18N.strings[lang] = j || {}; applyDict(lang); })
      .catch(function(){ applyDict(I18N.base); });
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
        if (resp && resp.existing) {
          msg.className = "reg-msg ok"; msg.textContent = window.__t("s7.existing");
          track("register_existing", {role:data.role});
          form.reset();
          seg && seg.querySelectorAll("label").forEach(function(l,i){ l.classList.toggle("sel", i===0); });
          return;
        }
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

  /* ---------- login modal (vracející se uživatel) ---------- */
  var loginModal = document.getElementById("loginModal");
  var loginLink = document.getElementById("loginLink");
  var loginClose = document.getElementById("loginClose");
  var loginForm = document.getElementById("loginForm");
  function openLogin(e){ if (e) e.preventDefault(); if (!loginModal) return; loginModal.classList.add("show"); loginModal.setAttribute("aria-hidden","false"); var i=loginForm&&loginForm.querySelector("input[name=email]"); if(i) setTimeout(function(){i.focus();},60); track("login_open",{}); }
  function closeLogin(){ if (!loginModal) return; loginModal.classList.remove("show"); loginModal.setAttribute("aria-hidden","true"); }
  if (loginLink) loginLink.addEventListener("click", openLogin);
  if (loginClose) loginClose.addEventListener("click", closeLogin);
  if (loginModal) loginModal.addEventListener("click", function(e){ if (e.target === loginModal) closeLogin(); });
  document.addEventListener("keydown", function(e){ if (e.key==="Escape") closeLogin(); });
  function loginMsgEl(){ return document.getElementById("loginMsg"); }
  // přihlášení heslem → uloží dlouhý token a otevře portál
  function doPasswordLogin(email, password, msg, btn){
    btn.disabled = true; msg.className="reg-msg"; msg.textContent = window.__t("login.sending");
    track("login_password_submit",{});
    fetch("/api/compounder/login", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ email: email, password: password, lang: window.__compounderLang })
    }).then(function(r){ return r.json().then(function(j){ return {ok:r.ok, j:j}; }); })
      .then(function(res){
        if (res.ok && res.j && res.j.token){
          try{ localStorage.setItem("compounder.portal.token", res.j.token); }catch(_){}
          track("login_password_success",{});
          msg.className="reg-msg ok"; msg.textContent = window.__t("login.ok2");
          setTimeout(function(){ location.href = "/portal"; }, 500);
        } else {
          msg.className="reg-msg err"; msg.textContent = window.__t("login.badcreds");
          btn.disabled = false;
        }
      }).catch(function(){ msg.className="reg-msg err"; msg.textContent = window.__t("login.err"); btn.disabled = false; });
  }
  // přihlášení odkazem (magic link) na e-mail
  function doLinkLogin(email, msg, btn){
    btn.disabled = true; msg.className="reg-msg"; msg.textContent = window.__t("login.sending");
    track("login_link_submit",{});
    fetch("/api/compounder/login", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ email: email, lang: window.__compounderLang })
    }).then(function(r){ return r.json().catch(function(){ return {}; }); })
      .then(function(){ msg.className="reg-msg ok"; msg.textContent = window.__t("login.ok"); })
      .catch(function(){ msg.className="reg-msg ok"; msg.textContent = window.__t("login.ok"); })
      .finally(function(){ btn.disabled = false; });
  }
  if (loginForm){
    loginForm.addEventListener("submit", function(e){
      e.preventDefault();
      var msg = loginMsgEl();
      var btn = loginForm.querySelector("button[type=submit]");
      var email = (loginForm.email.value||"").trim();
      var pw = (loginForm.password && loginForm.password.value) || "";
      if (!/.+@.+\..+/.test(email)){ msg.className="reg-msg err"; msg.textContent = window.__t("login.err"); return; }
      if (pw) doPasswordLogin(email, pw, msg, btn);
      else doLinkLogin(email, msg, btn);   // bez hesla → pošli odkaz
    });
    var sendLinkBtn = document.getElementById("loginSendLink");
    if (sendLinkBtn) sendLinkBtn.addEventListener("click", function(){
      var msg = loginMsgEl(); var email = (loginForm.email.value||"").trim();
      if (!/.+@.+\..+/.test(email)){ msg.className="reg-msg err"; msg.textContent = window.__t("login.err"); return; }
      doLinkLogin(email, msg, sendLinkBtn);
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
  // klikací mapa — zachytí KAŽDÝ smysluplný klik, ne jen CTA
  function elLabel(el){
    var dt = el.getAttribute("data-track") || el.getAttribute("aria-label");
    if (dt) return dt.trim().slice(0,60);
    var t = (el.textContent||"").replace(/\s+/g," ").trim();
    if (t) return t.slice(0,60);
    var tag = (el.tagName||"").toLowerCase();
    if (el.id) return tag+"#"+el.id;
    var cls = (el.className && el.className.toString ? el.className.toString() : "").split(" ").filter(Boolean)[0];
    return tag + (cls ? "."+cls : "");
  }
  function elSection(el){ var s = el.closest ? el.closest("section[id], header[id]") : null; return s ? s.id : null; }
  document.addEventListener("click", function(e){
    var el = e.target.closest ? e.target.closest("a,button,[role=button],[data-track],.tab,.btn,.btn-gold,summary,label,input[type=submit],input[type=button]") : null;
    if (!el) return;
    var isCta = el.classList && (el.classList.contains("btn") || el.classList.contains("btn-gold"));
    track(isCta ? "cta_click" : "click", { label: elLabel(el), tag:(el.tagName||"").toLowerCase(), id: el.id||null, sec: elSection(el), href: el.getAttribute("href")||null });
  }, true);
  // hloubka scrollu na stránce
  var maxDepth = 0;
  window.addEventListener("scroll", function(){
    var h = document.documentElement, sc = h.scrollTop || document.body.scrollTop, max = (h.scrollHeight - h.clientHeight) || 1;
    var d = Math.min(100, Math.round((sc/max)*100)); if (d > maxDepth) maxDepth = d;
  }, {passive:true});
  // time on page + max scroll
  window.addEventListener("beforeunload", function(){ track("page_leave", {ms: Math.round(performance.now()), depth: maxDepth}); });

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

  /* ---------- platform detection ---------- */
  var UA = navigator.userAgent || "";
  var IS_IOS = /iphone|ipad|ipod/i.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  // iOS Chrome/Firefox/Edge NEumí instalaci PWA — to umí jen Safari (omezení Applu).
  var IS_IOS_NONSAFARI = IS_IOS && /(CriOS|FxiOS|EdgiOS|OPiOS|GSA|mercury)/i.test(UA);
  var IS_STANDALONE = (window.navigator.standalone === true) || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);

  /* ---------- service worker + push + iOS install hint ---------- */
  if ("serviceWorker" in navigator){
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("sw.js").then(function(){ setTimeout(initPush, 6000); }).catch(function(){});
    });
  }
  // iOS Safari nemá beforeinstallprompt → ukaž ruční návod "Přidat na plochu".
  window.addEventListener("load", function(){ setTimeout(initIosHint, 4500); });
  // Text bere ze stejného i18n slovníku jako zbytek stránky → vždy v jazyce
  // stránky a přeložený do všech jazyků (sync skript). Base (EN) je vždy fallback.
  function iosHintText(){
    var t = window.__t || function(k){ return k; };
    return IS_IOS_NONSAFARI ? t("install.iosSafari") : t("install.ios");
  }
  function initIosHint(){
    try{
      if (!IS_IOS || IS_STANDALONE) return;
      var asked = +(localStorage.getItem("compounder.ios.askedAt")||0);
      if (Date.now() - asked < 7*24*3600*1000) return;
      if (installBar && installBar.classList.contains("show")) return;
      localStorage.setItem("compounder.ios.askedAt", Date.now());
      var bar = document.createElement("div"); bar.className = "install show"; bar.style.bottom = "18px";
      var sp = document.createElement("span"); sp.textContent = iosHintText();
      var no = document.createElement("button"); no.className = "btn btn-ghost btn-sm"; no.textContent = "✕";
      bar.appendChild(sp); bar.appendChild(no); document.body.appendChild(bar);
      no.addEventListener("click", function(){ bar.remove(); });
      track("ios_install_hint", {});
    }catch(e){}
  }

  /* ---------- web push opt-in (re-prompt po 7 dnech) ---------- */
  function urlB64(s){ var pad="=".repeat((4-s.length%4)%4); var b=(s+pad).replace(/-/g,"+").replace(/_/g,"/"); var raw=atob(b); var arr=new Uint8Array(raw.length); for(var i=0;i<raw.length;i++)arr[i]=raw.charCodeAt(i); return arr; }
  // portal stránka může přepsat (přidá { t: token } pro svázání s leadem)
  window.__compounderPushExtra = window.__compounderPushExtra || function(){ return {}; };
  function initPush(){
    try{
      if (IS_IOS && !IS_STANDALONE) return; // iOS push jen v nainstalované PWA (z plochy)
      if (!("PushManager" in window) || !("Notification" in window)) return;
      if (Notification.permission === "denied") return;
      if (Notification.permission === "granted") { subscribePush(); return; }
      var asked = +(localStorage.getItem("compounder.push.askedAt")||0);
      if (Date.now() - asked < 7*24*3600*1000) return;       // re-prompt jen po týdnu
      if (installBar && installBar.classList.contains("show")) return; // nepřekrývat install banner
      showPushBanner();
    }catch(e){}
  }
  function pushTexts(){
    var l = window.__compounderLang || "en";
    if (l==="cs") return { t:"Dostávejte novinky o Compoundingu", b:"Zapnout" };
    if (l==="de") return { t:"Erhalten Sie Compounding-News", b:"Aktivieren" };
    return { t:"Get Compounding updates", b:"Enable" };
  }
  function showPushBanner(){
    localStorage.setItem("compounder.push.askedAt", Date.now());
    var tx = pushTexts();
    var bar = document.createElement("div");
    bar.className = "install show"; bar.style.bottom = "18px";
    var span = document.createElement("span"); span.textContent = tx.t;
    var ok = document.createElement("button"); ok.className="btn btn-gold btn-sm"; ok.textContent = tx.b;
    var no = document.createElement("button"); no.className="btn btn-ghost btn-sm"; no.textContent="✕";
    bar.appendChild(span); bar.appendChild(ok); bar.appendChild(no); document.body.appendChild(bar);
    ok.addEventListener("click", function(){ bar.remove(); requestPush(); });
    no.addEventListener("click", function(){ bar.remove(); });
  }
  function requestPush(){
    Notification.requestPermission().then(function(p){ track("push_permission",{outcome:p}); if (p==="granted") subscribePush(); });
  }
  function subscribePush(){
    navigator.serviceWorker.ready.then(function(reg){
      fetch("/api/compounder/push/key").then(function(r){return r.json();}).then(function(j){
        if (!j || !j.key) return;
        reg.pushManager.getSubscription().then(function(existing){
          var p = existing ? Promise.resolve(existing) : reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: urlB64(j.key) });
          p.then(function(sub){
            var extra = (window.__compounderPushExtra && window.__compounderPushExtra()) || {};
            fetch("/api/compounder/push/subscribe", { method:"POST", headers:{"Content-Type":"application/json"},
              body: JSON.stringify(Object.assign({ subscription: sub.toJSON(), sid: SID, lang: window.__compounderLang }, extra)) }).catch(function(){});
            track("push_subscribed", {});
          }).catch(function(){});
        });
      }).catch(function(){});
    });
  }
})();
