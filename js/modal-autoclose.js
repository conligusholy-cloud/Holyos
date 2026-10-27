// HolyOS — Globální pravidlo pro dialogová okna: zavření klikem mimo okno (na ztmavené pozadí) a klávesou Esc.
// Standard pro VŠECHNA modální okna v systému (načítá se přes js/sidebar.js).
// Výjimka: přidej na překryvnou vrstvu atribut data-no-backdrop-close (např. okno s rozdělanou prací, které se nesmí zavřít omylem).
(function () {
  if (window.__holyosModalAutoClose) return;
  window.__holyosModalAutoClose = true;

  var NAME_RE = /modal|overlay|backdrop|dialog|popup|lightbox/i;
  var CLOSE_X_RE = /^[\s×✕✖✗xX]+$/;
  var CLOSE_TXT_RE = /(zavřít|zavrit|zrušit|zrusit|storno|zpět|zpet|close|cancel)/i;

  // Je element překryvná vrstva (fixed přes celé okno, ztmavené nebo pojmenované jako modal)?
  function isBackdrop(el) {
    if (!el || el === document.body || el === document.documentElement || el.nodeType !== 1) return false;
    if (el.hasAttribute('data-no-backdrop-close')) return false;
    var cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    if (r.width < innerWidth * 0.95 || r.height < innerHeight * 0.95) return false;
    if (!el.firstElementChild) return false;
    var named = NAME_RE.test((el.className && el.className.baseVal === undefined ? el.className : '') + ' ' + el.id);
    var m = /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+))?\s*\)/.exec(cs.backgroundColor || '');
    var dimmed = !!m && m[1] !== undefined && parseFloat(m[1]) > 0 && parseFloat(m[1]) < 1;
    return named || dimmed;
  }

  function visible(el) { return el.getClientRects().length > 0; }

  // Najde tlačítko, které okno zavírá (×, „Zavřít“, „Zrušit“…). Preferuje křížek / třídu close.
  function findCloseControl(backdrop) {
    var cands = backdrop.querySelectorAll('button, a, [role="button"], [onclick], .close, [class*="close"], [class*="Close"]');
    var pref = null, fallback = null;
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (!visible(c) || c.disabled) continue;
      var txt = (c.textContent || '').trim();
      var cls = (typeof c.className === 'string' ? c.className : '') + ' ' + (c.getAttribute('aria-label') || '');
      if (!pref && (CLOSE_X_RE.test(txt) || /(^|[\s_-])(close|x)([\s_-]|$)|modal-close|btn-close|-x\b/i.test(cls) || /close|zavřít/i.test(c.getAttribute('aria-label') || ''))) pref = c;
      if (!fallback && txt.length <= 24 && CLOSE_TXT_RE.test(txt)) fallback = c;
    }
    return pref || fallback;
  }

  function closeBackdrop(backdrop) {
    var ctl = findCloseControl(backdrop);
    if (ctl) { ctl.click(); return true; }
    return false;
  }

  // Zavírat jen když stisk i puštění myši proběhly na pozadí (ne při výběru textu tažením z okna ven)
  var downOn = null;
  document.addEventListener('mousedown', function (e) { downOn = e.target; }, true);
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || downOn !== t) return;
    if (!isBackdrop(t)) return;
    closeBackdrop(t);
  }, true);

  // Esc zavře nejvyšší otevřené okno (a nezasahuje, když se píše do pole s vlastním Esc)
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    var best = null, bestZ = -1;
    // překryvné vrstvy bývají přímými potomky body, nebo uvnitř kontejneru modulu — projdeme obojí
    var nodes = document.querySelectorAll('body *');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.children.length === 0) continue;
      var cs = getComputedStyle(el);
      if (cs.position !== 'fixed') continue;
      if (!isBackdrop(el)) continue;
      var z = parseInt(cs.zIndex, 10); if (isNaN(z)) z = 0;
      if (z >= bestZ) { best = el; bestZ = z; }
    }
    if (best && closeBackdrop(best)) e.stopPropagation();
  }, true);
})();
