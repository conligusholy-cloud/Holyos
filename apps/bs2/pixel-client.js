/* BS2 — souhlas s marketingovými cookies + Meta Pixel (načítá se jen po souhlasu).
   Servíruje se jako /bs2-pixel.js (server.js nahradí __PIXEL_ID__). Vkládá se do <head> veřejných stránek.
   Veřejné API:  window.bs2Pixel.event(name, params, eventId)  – odešle událost jen s platným souhlasem
                 window.bs2Pixel.open()                        – znovu otevře nastavení cookies
   Pravidla: bez souhlasu se nenačte fbevents.js (ani <noscript> obrázek – ten souhlas respektovat nemůže, proto tu není);
   odmítnutí / odvolání zastaví odesílání a smaže cookies _fbp/_fbc; PageView se měří 1× na adresu (i při přechodech bez obnovení);
   do URL a parametrů událostí se neposílají osobní údaje (citlivé parametry se z adresy odstraní dřív, než pixel start). */
(function () {
  'use strict';
  if (window.__bs2PixelLoaded) return; window.__bs2PixelLoaded = true;

  var ID = '__PIXEL_ID__', KEY = 'bs2_cookie_consent', VER = 1;
  var SENSITIVE = ['t', 's', 'token', 'login', 'email', 'e-mail', 'phone', 'tel', 'name', 'first_name', 'last_name', 'jmeno', 'prijmeni', 'telefon'];

  // ── 0) Co potřebujeme z adresy, než ji stránka přepíše (návrat ze Stripe: ?paid=1&s=<session>) ──
  try {
    var q0 = new URLSearchParams(location.search);
    if (q0.get('paid') === '1' && /^cs_[A-Za-z0-9_]{10,200}$/.test(q0.get('s') || '')) sessionStorage.setItem('bs2_pp', q0.get('s'));
  } catch (e) { /* bez sessionStorage se Purchase jen neodešle */ }

  // ── 1) Souhlas ──
  var mem = null;
  function cookieGet(n) { var m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; }
  function readConsent() {
    try { var o = JSON.parse(localStorage.getItem(KEY) || 'null'); if (o && o.v === VER && typeof o.marketing === 'boolean') return o; } catch (e) { /* dál */ }
    var c = cookieGet('bs2_cc'); if (c === '1' || c === '0') return { v: VER, marketing: c === '1' };
    return mem;
  }
  function saveConsent(m) {
    var o = { v: VER, marketing: !!m, at: Date.now() }; mem = o;
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* cookie níž */ }
    document.cookie = 'bs2_cc=' + (m ? '1' : '0') + '; Max-Age=15552000; Path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
    return o;
  }
  var consent = readConsent();
  function allowed() { return !!(consent && consent.marketing); }

  // ── 2) Úklid adresy (žádné osobní údaje do URL, kterou pixel čte) ──
  var silent = false;
  function sanitizeUrl() {
    try {
      var u = new URL(location.href), changed = false;
      SENSITIVE.forEach(function (k) { if (u.searchParams.has(k)) { u.searchParams.delete(k); changed = true; } });
      if (changed) { silent = true; history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash); silent = false; }
    } catch (e) { silent = false; }
  }

  // ── 3) Pixel ──
  var loaded = false, inited = false, started = false, lastKey = '', queue = [];
  function loadPixel() {
    if (loaded) return; loaded = true;
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq.disablePushState = true; // přechody bez obnovení řídíme sami (bez duplicit)
  }
  function pageView() {
    if (!started) return;
    var key = location.pathname + location.search; // bez #hash: kotva není nová stránka
    if (key === lastKey) return; lastKey = key;
    window.fbq('track', 'PageView');
  }
  function sentIds() { try { return JSON.parse(localStorage.getItem('bs2_fbq_sent') || '[]'); } catch (e) { return []; } }
  function markSent(id) { try { var a = sentIds(); a.push(id); localStorage.setItem('bs2_fbq_sent', JSON.stringify(a.slice(-60))); } catch (e) { /* nic */ } }
  function fire(name, params, id) {
    if (id) { if (sentIds().indexOf(id) >= 0) return; markSent(id); }
    if (id) window.fbq('track', name, params || {}, { eventID: id }); else window.fbq('track', name, params || {});
  }
  function start() {
    if (!allowed() || started) return;
    sanitizeUrl(); loadPixel();
    if (!inited) { window.fbq('init', ID); inited = true; } else { try { window.fbq('consent', 'grant'); } catch (e) { /* nic */ } }
    started = true; lastKey = ''; pageView();
    var q = queue; queue = []; q.forEach(function (x) { fire(x[0], x[1], x[2]); });
    checkPurchase();
  }
  function stop() {
    started = false; queue = [];
    try { if (window.fbq) window.fbq('consent', 'revoke'); } catch (e) { /* nic */ }
    try { sessionStorage.removeItem('bs2_pp'); } catch (e) { /* nic */ }
    var host = location.hostname, parts = host.split('.'), roots = [host, '.' + host];
    if (parts.length > 2) roots.push('.' + parts.slice(-2).join('.'));
    ['_fbp', '_fbc'].forEach(function (n) { roots.forEach(function (d) { document.cookie = n + '=; Max-Age=0; Path=/; Domain=' + d; }); document.cookie = n + '=; Max-Age=0; Path=/'; });
  }

  // ── 4) Veřejné API pro události ──
  window.bs2Pixel = {
    event: function (name, params, eventId) {
      if (!allowed()) return false;
      if (!started) { queue.push([name, params, eventId]); return true; }
      fire(name, params, eventId); return true;
    },
    open: function () { openBanner(true); },
    consent: function () { return allowed(); },
  };

  // ── 5) Purchase: až po potvrzené platbě (server ověří objednávku / Stripe session), se skutečnou částkou v CZK ──
  var polling = false;
  function checkPurchase() {
    var sid = ''; try { sid = sessionStorage.getItem('bs2_pp') || ''; } catch (e) { /* nic */ }
    if (!sid || polling || !allowed()) return; polling = true;
    var tries = 0;
    (function poll() {
      if (!allowed()) { polling = false; return; }
      fetch('/api/location/paid-info?s=' + encodeURIComponent(sid), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        if (j && j.paid && j.value > 0 && j.currency === 'CZK') {
          window.bs2Pixel.event('Purchase', { value: j.value, currency: 'CZK', content_type: 'product', content_ids: [String(j.package || 'online')], content_name: j.name || 'Online aplikace', num_items: 1 }, 'purchase-' + j.order_id);
          try { sessionStorage.removeItem('bs2_pp'); } catch (e) { /* nic */ }
          polling = false; return;
        }
        if (++tries < 10) setTimeout(poll, 3000); else polling = false; // platba ještě není potvrzena → nic neodesíláme
      }).catch(function () { if (++tries < 10) setTimeout(poll, 3000); else polling = false; });
    })();
  }

  // ── 6) Lišta souhlasu ──
  var banner = null;
  function openBanner(reopen) {
    if (banner) { banner.remove(); banner = null; }
    var cur = allowed();
    var st = document.createElement('style'); st.setAttribute('data-bs2cc', '1');
    st.textContent = '#bs2cc{position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;max-width:760px;margin:0 auto;background:#0d1426;color:#eaf2ff;border:1px solid rgba(120,160,255,.35);border-radius:16px;padding:16px 18px;box-shadow:0 20px 60px rgba(0,0,0,.6);font:14px/1.5 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}'
      + '#bs2cc b{display:block;font-size:15px;margin-bottom:4px}#bs2cc p{margin:0 0 12px;color:#aebcd6}#bs2cc a{color:#4fd1ff}'
      + '#bs2cc .r{display:flex;gap:8px;flex-wrap:wrap}#bs2cc button{font:inherit;font-weight:700;cursor:pointer;border-radius:10px;padding:10px 16px;border:1px solid rgba(120,160,255,.35);background:transparent;color:#eaf2ff}'
      + '#bs2cc button.p{border:none;color:#fff;background:linear-gradient(90deg,#1e86e0,#3a6cf5 55%,#7c5cff)}#bs2cc button:focus-visible{outline:2px solid #4fd1ff;outline-offset:2px}';
    document.head.appendChild(st);
    banner = document.createElement('div'); banner.id = 'bs2cc'; banner.setAttribute('role', 'dialog'); banner.setAttribute('aria-label', 'Nastavení cookies');
    banner.innerHTML = '<b>Cookies a měření reklamy</b><p>S vaším souhlasem používáme marketingové cookies a Meta Pixel, abychom změřili, jak naše reklama funguje. Bez souhlasu se nic z toho nenačte. Souhlas můžete kdykoli změnit v patičce („Nastavení cookies“). Více v <a href="/location/gdpr">zásadách ochrany osobních údajů</a>.'
      + (reopen ? ' <i>Nyní: ' + (cur ? 'povoleno' : 'odmítnuto') + '.</i>' : '') + '</p><div class="r"><button type="button" class="p" data-a="1">Povolit marketingové cookies</button><button type="button" data-a="0">Odmítnout</button>' + (reopen ? '<button type="button" data-a="x">Zavřít</button>' : '') + '</div>';
    document.body.appendChild(banner);
    banner.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-a]'); if (!b) return; var a = b.getAttribute('data-a');
      if (a !== 'x') {
        var was = allowed(); consent = saveConsent(a === '1');
        if (a === '1' && !was) start(); else if (a === '0' && was) stop();
      }
      banner.remove(); banner = null; st.remove();
    });
    var first = banner.querySelector('button.p'); if (first && reopen) first.focus();
  }

  // ── 7) Přechody bez obnovení stránky ──
  function onNav() { if (silent || !started) return; sanitizeUrl(); pageView(); }
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m]; if (!orig) return;
    history[m] = function () { var r = orig.apply(this, arguments); if (!silent) setTimeout(onNav, 0); return r; };
  });
  window.addEventListener('popstate', function () { setTimeout(onNav, 0); });

  // ── 8) Start ──
  function init() {
    document.addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('[data-bs2-cookies]'); if (a) { e.preventDefault(); openBanner(true); } });
    if (consent === null) openBanner(false); else if (allowed()) start();
  }
  function ready() { if (document.body) init(); else document.addEventListener('DOMContentLoaded', init); }
  // pixel startuje až po načtení stránky (stránka si dřív přečte svoje parametry, my pak adresu uklidíme)
  if (document.readyState === 'complete') ready(); else window.addEventListener('load', ready);
})();
