// HolyOS — hlídač nové verze (samostatný, pro mobilní stránky bez sidebaru)
// Když se na serveru změní build (nový deploy), ukáže nahoře nenásilnou lištu
// „je nová verze — obnovit". Nic nevynucuje; uživatel pracuje dál a obnoví, až chce.
// Na stránkách se sidebarem se watcher spouští ze sidebar.js — tam se tento soubor
// nepřidává (guard window.__holyosVerWatch zabrání dvojímu spuštění).
(function () {
  function initVersionWatcher() {
    if (window.__holyosVerWatch) return; window.__holyosVerWatch = true;
    var baseline = null, dismissed = null, shown = false;
    function readBuild() {
      return fetch('/api/health', { cache: 'no-store', credentials: 'include' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return (j && j.build) ? String(j.build) : null; })
        .catch(function () { return null; });
    }
    function showBanner(nv) {
      if (shown) return; shown = true;
      var bar = document.createElement('div');
      bar.id = 'holyos-version-bar';
      bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:linear-gradient(135deg,#6c5ce7,#0984e3);color:#fff;font-size:13px;padding:8px 14px;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;box-shadow:0 2px 10px rgba(0,0,0,0.3);font-family:inherit;';
      bar.innerHTML = '<span>🔄 Je dostupná nová verze HolyOS. Ulož rozdělanou práci a obnov, až se ti to bude hodit.</span>'
        + '<button id="holyos-version-reload" style="background:#fff;color:#3b2fb0;border:none;border-radius:8px;padding:5px 12px;font-weight:700;cursor:pointer;font-size:13px;">Obnovit teď</button>'
        + '<button id="holyos-version-dismiss" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.6);border-radius:8px;padding:5px 10px;cursor:pointer;font-size:13px;">Později</button>';
      document.body.appendChild(bar);
      document.getElementById('holyos-version-reload').onclick = function () { location.reload(); };
      document.getElementById('holyos-version-dismiss').onclick = function () { dismissed = nv; shown = false; bar.remove(); };
    }
    function check() {
      readBuild().then(function (b) {
        if (!b) return;
        if (baseline === null) { baseline = b; return; } // první měření = referenční verze
        if (b !== baseline && b !== dismissed) showBanner(b);
      });
    }
    check();
    setInterval(check, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVersionWatcher);
  } else {
    initVersionWatcher();
  }
})();
