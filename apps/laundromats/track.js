// Laundromats — sledování chování návštěvníka (běží na všech stránkách /cesta…).
// Události jdou přes /api/cesta/track do HolyOS (compounder_events). Kontakt se pozná podle t/l z odkazu ze SMS / e-mailu
// (HolyOS je ověří podpisem); bez odkazu zůstává návštěvník anonymní (sid) a napojí se až při rezervaci schůzky.
(function () {
  'use strict';
  if (window.lmTrack) return;
  var LS = null; try { LS = window.localStorage; } catch (e) {}
  var get = function (k) { try { return LS ? LS.getItem(k) : null; } catch (e) { return null; } };
  var set = function (k, v) { try { if (LS) LS.setItem(k, v); } catch (e) {} };
  var rnd = function () { return Math.random().toString(36).slice(2, 10); };

  // ── identita: sid (prohlížeč) + t/l (kontakt) ──
  // sid: localStorage → cookie ze serveru (přežije smazání localStorage v Safari) → nový
  var ckSid = (document.cookie.match(/(?:^|; )lm_sid=([^;]+)/) || [])[1];
  try { ckSid = ckSid ? decodeURIComponent(ckSid) : ''; } catch (e) { ckSid = ''; }
  var sid = get('lm_sid') || (/^lm-[a-z0-9]{4,60}$/.test(ckSid) ? ckSid : '');
  if (!sid) sid = 'lm-' + Date.now().toString(36) + rnd();
  set('lm_sid', sid);
  // t/l: odkaz v adrese → localStorage; když chybí obojí, doplní je server z HttpOnly cookie lm_tl
  var q = new URLSearchParams(location.search);
  var t = q.get('t'), l = q.get('l');
  if (t || l) { set('lm_tl', JSON.stringify({ t: t || '', l: l || '' })); }
  else { try { var s = JSON.parse(get('lm_tl') || 'null'); if (s) { t = s.t; l = s.l; } } catch (e) {} }
  window.lmSid = function () { return sid; };

  // ── stránka ──
  var path = location.pathname, pl = /^\/cesta\/pl(\/|$)/.test(path);
  var norm = path.replace(/^\/cesta\/pl/, '/cesta').replace(/\/$/, '') || '/cesta';
  var PAGES = { '/cesta': 'lm_cesta', '/cesta/info': 'lm_info', '/cesta/vlastni-kapital': 'lm_vlastni', '/cesta/financovani': 'lm_financovani', '/cesta/schuzka': 'lm_schuzka', '/cesta/ekonomika': 'lm_ekonomika', '/cesta/ekonomika/podrobne': 'lm_ekonomika_detail' };
  var page = PAGES[norm] || ('lm_' + norm.replace(/[^a-z0-9]+/gi, '_'));
  var lang = pl ? 'pl' : 'cs';

  function send(event, props, beacon) {
    var body = JSON.stringify({ sid: sid, event: event, path: path, lang: lang, props: Object.assign({ site: 'laundromats', page: page, t: t || undefined, l: l || undefined }, props || {}) });
    try {
      if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/cesta/track', new Blob([body], { type: 'application/json' })); return; }
      fetch('/api/cesta/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
    } catch (e) {}
  }
  window.lmTrack = function (event, props) { send(event, props); };

  // ── nová návštěva = pauza > 30 min ──
  var now = Date.now(), last = Number(get('lm_last') || 0);
  var fresh = !last || (now - last) > 30 * 60 * 1000;
  var utm = {}; ['utm_source', 'utm_medium', 'utm_campaign', 'ch'].forEach(function (k) { if (q.get(k)) utm[k] = q.get(k); });
  if (fresh) send('page_view', Object.assign({ ref: document.referrer ? document.referrer.slice(0, 200) : '', w: window.innerWidth, ident: !!(t || l) }, utm));
  send('page_switch', { title: (document.title || '').slice(0, 80) });
  set('lm_last', String(now));

  // ── kliky (delegovaně) ──
  function label(el) {
    var txt = (el.getAttribute('aria-label') || el.textContent || el.value || '').replace(/\s+/g, ' ').trim();
    return txt.slice(0, 70) || el.getAttribute('title') || el.id || '';
  }
  function sectionOf(el) {
    var s = el.closest('section,.bx-card,.pe-section,.ek-panel,.bx-kpis,.bx-item');
    if (!s) return '';
    var h = s.querySelector('h1,h2,h3,.bx-q-eyebrow');
    return h ? h.textContent.replace(/\s+/g, ' ').trim().slice(0, 50) : '';
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('a,button,[onclick],.pe-section-head,select,label');
    if (!el) return;
    var lb = label(el); if (!lb) return;
    var href = el.getAttribute('href') || '';
    var cta = el.matches('.bx-path,.btn,a.bx-path,[data-cta]');
    send(cta ? 'cta_click' : 'click', { label: lb, href: href.slice(0, 120) || undefined, sec: sectionOf(el) || undefined });
  }, true);

  // ── zobrazené sekce ──
  if ('IntersectionObserver' in window) {
    var seen = {};
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (!en.isIntersecting) return; io.unobserve(en.target);
        var h = en.target.querySelector('h1,h2,h3,.bx-q-eyebrow,.bx-label,.k'); var name = h ? h.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
        if (!name || seen[name]) return; seen[name] = 1; send('section_view', { section: name });
      });
    }, { threshold: 0.5 });
    setTimeout(function () { [].forEach.call(document.querySelectorAll('.bx-card,.bx-kpi,.bx-hr,.ek-panel,.ek-m,.bx-closing,.pe-section'), function (n) { io.observe(n); }); }, 600);
  }

  // ── scroll + doba (aktivní čas, když je karta vidět) ──
  var depth = 0, visibleMs = 0, since = document.hidden ? 0 : Date.now(), ended = false;
  window.addEventListener('scroll', function () {
    var h = document.documentElement, max = (h.scrollHeight - h.clientHeight) || 1;
    var d = Math.min(100, Math.round(((h.scrollTop || document.body.scrollTop) / max) * 100)); if (d > depth) depth = d;
  }, { passive: true });
  function end() {
    if (since) { visibleMs += Date.now() - since; since = 0; }
    if (visibleMs < 1500) return;
    send('visit_end', { ms: visibleMs, depth: depth }, true); set('lm_last', String(Date.now()));
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) end(); else since = Date.now(); });
  window.addEventListener('pagehide', end);
})();
