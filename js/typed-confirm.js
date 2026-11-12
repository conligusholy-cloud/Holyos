// HolyOS — Potvrzení nevratného smazání opsáním slova (např. „SMAZAT")
// Použití: if (!(await typedConfirm({ title: 'Smazat rezervaci', text: 'PATMAXIM – MINI CZ' }))) return;
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  window.typedConfirm = function (opts) {
    opts = opts || {};
    var word = (opts.word || 'SMAZAT').toUpperCase();
    return new Promise(function (resolve) {
      var ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(2,6,14,.78);display:flex;align-items:center;justify-content:center;padding:20px;';
      ov.innerHTML =
        '<div style="background:#1e1b2e;border:1px solid rgba(239,68,68,.55);border-radius:14px;max-width:440px;width:100%;padding:22px;color:#e8eefc;font-family:inherit;box-shadow:0 20px 60px rgba(0,0,0,.6)">' +
          '<div style="font-size:17px;font-weight:800;color:#f87171;margin-bottom:8px">⚠️ ' + esc(opts.title || 'Nevratné smazání') + '</div>' +
          (opts.text ? '<div style="font-size:13.5px;line-height:1.5;margin-bottom:10px">' + esc(opts.text) + '</div>' : '') +
          '<div style="font-size:13px;color:#cbd5e1;margin-bottom:8px">Pro potvrzení napiš <b style="color:#f87171;letter-spacing:.05em">' + esc(word) + '</b>:</div>' +
          '<input type="text" autocomplete="off" spellcheck="false" style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid rgba(148,163,184,.4);background:#0f172a;color:#fff;font-size:15px;font-weight:700;letter-spacing:.05em">' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">' +
            '<button type="button" data-a="no" style="padding:8px 16px;border-radius:8px;border:1px solid rgba(148,163,184,.4);background:transparent;color:#e8eefc;cursor:pointer;font-family:inherit">Zrušit</button>' +
            '<button type="button" data-a="yes" disabled style="padding:8px 16px;border-radius:8px;border:0;background:#dc2626;color:#fff;font-weight:700;cursor:not-allowed;opacity:.45;font-family:inherit">🗑️ Smazat</button>' +
          '</div></div>';
      document.body.appendChild(ov);
      var inp = ov.querySelector('input'), yes = ov.querySelector('[data-a=yes]'), no = ov.querySelector('[data-a=no]');
      function ok() { return inp.value.trim().toUpperCase() === word; }
      function done(v) { document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); }
      function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); done(false); } else if (e.key === 'Enter' && ok()) { e.preventDefault(); done(true); } }
      inp.addEventListener('input', function () { var v = ok(); yes.disabled = !v; yes.style.opacity = v ? '1' : '.45'; yes.style.cursor = v ? 'pointer' : 'not-allowed'; });
      yes.onclick = function () { if (ok()) done(true); };
      no.onclick = function () { done(false); };
      ov.addEventListener('click', function (e) { if (e.target === ov) done(false); });
      document.addEventListener('keydown', onKey, true);
      setTimeout(function () { inp.focus(); }, 30);
    });
  };
  // Hlavička, kterou backend vyžaduje u chráněného mazání
  window.TYPED_CONFIRM_HEADER = { 'X-Confirm-Delete': 'SMAZAT' };
})();
