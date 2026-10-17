// Prádlomat — sdílený rezervační widget schůzky (pradlomaty.info).
// Použití: <div data-booking data-path="vlastni|financovani"></div> + <script src="booking.js"></script>
// Tok: Online / Osobně → týdenní kalendář (Tento týden | Příští týden) → klik na termín → potvrzení.
// Pravidla: nejbližší termín 2 h od teď (hlídá i server), jeden lead = jeden aktivní termín.
(function () {
  'use strict';
  var CSS = [
    '.bk{position:relative}',
    '.bk-h{position:relative;font-size:clamp(21px,5.4vw,28px);font-weight:700;line-height:1.16;letter-spacing:-.01em;margin-bottom:6px}',
    '.bk-h .g{color:#4aa3ea}',
    '.bk-sub{position:relative;font-size:14.5px;color:#c3d6e8;margin-bottom:18px}',
    '.bk-modes{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '.bk-mode{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;border:none;border-radius:12px;padding:20px 12px;color:#fff;font-family:inherit;font-size:16px;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#1e86e0,#3aa0f0);box-shadow:0 14px 32px -12px rgba(30,134,224,.85);transition:filter .2s,transform .15s}',
    '.bk-mode:hover{filter:brightness(1.08);transform:translateY(-2px)}',
    '.bk-mode svg{width:30px;height:30px;stroke:#fff;fill:none;stroke-width:1.7}',
    '.bk-mode small{font-size:12px;font-weight:500;color:rgba(255,255,255,.82)}',
    '.bk-back{background:none;border:none;color:#7fa6c8;font-size:13px;cursor:pointer;padding:0;margin-bottom:10px;font-family:inherit}',
    '.bk-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;background:rgba(30,134,224,.10);border:0.5px solid rgba(46,140,224,.3);border-radius:12px;padding:4px;margin:0 0 14px}',
    '.bk-tab{border:none;border-radius:9px;padding:10px 8px;font-family:inherit;font-size:13.5px;font-weight:600;color:#9db6cd;background:transparent;cursor:pointer;transition:background .15s,color .15s}',
    '.bk-tab.on{background:linear-gradient(135deg,#1e86e0,#3aa0f0);color:#fff;box-shadow:0 8px 20px -10px rgba(30,134,224,.9)}',
    '.bk-range{font-size:12.5px;color:#7fa6c8;text-align:center;margin:-6px 0 12px}',
    '.bk-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}',
    '.bk-d{display:flex;flex-direction:column;gap:6px;min-width:0}',
    '.bk-dh{text-align:center;padding:8px 2px;border-radius:10px;background:rgba(30,134,224,.10);border:0.5px solid rgba(46,140,224,.3);line-height:1.15}',
    '.bk-dh .dn{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7fa6c8;font-weight:600}',
    '.bk-dh .dd{display:block;font-size:15px;font-weight:700;color:#e9f0f7;margin-top:2px}',
    '.bk-d.today .bk-dh{background:rgba(62,224,138,.14);border-color:rgba(62,224,138,.5)}',
    '.bk-d.today .bk-dh .dn{color:#3ee08a}',
    '.bk-d.past{opacity:.38}',
    '.bk-none{text-align:center;font-size:12px;color:#7fa6c8;padding:8px 0}',
    '.bk-slot{width:100%;border:1px solid rgba(46,140,224,.3);background:#0e1e33;border-radius:9px;padding:9px 2px;font-size:13px;font-weight:600;color:#e9f0f7;cursor:pointer;font-family:inherit;transition:border-color .15s,background .15s;white-space:nowrap}',
    '.bk-slot:hover{border-color:#1e86e0;background:#12294a}',
    '.bk-slot:disabled{opacity:.5;cursor:default}',
    '@media(max-width:480px){.bk-week{gap:4px}.bk-slot{font-size:12px;padding:8px 0}.bk-dh .dd{font-size:13px}.bk-dh .dn{font-size:9.5px}}',
    '.bk-empty{text-align:center;padding:18px 8px;font-size:14.5px;color:#9db6cd}',
    '.bk-done{text-align:center;padding:14px}',
    '.bk-done .ic{width:56px;height:56px;border-radius:50%;background:rgba(62,224,138,.15);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}',
    '.bk-done .ic svg{width:28px;height:28px;stroke:#3ee08a;fill:none;stroke-width:2.4}',
    '.bk-done h3{font-size:19px;font-weight:700;margin-bottom:6px}',
    '.bk-done p{font-size:14.5px;color:#c3d6e8}',
    '.bk-done .chips{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:10px 0 4px}',
    '.bk-chip{font-size:12.5px;color:#dceaf6;background:rgba(30,134,224,.12);border:0.5px solid rgba(46,140,224,.4);padding:5px 12px;border-radius:999px}',
    '.bk-change{margin-top:12px;background:none;border:1px solid rgba(46,140,224,.3);border-radius:10px;padding:10px 14px;color:#4aa3ea;font-size:13.5px;font-weight:600;font-family:inherit;cursor:pointer}',
    '.bk-status{min-height:20px;margin-top:12px;font-size:14px;color:#4aa3ea;text-align:center}',
    '.bk-foot{position:relative;margin-top:14px;text-align:center;font-size:12.5px;color:#7fa6c8}'
  ].join('\n');

  var DN = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
  var DAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
  var MON = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
  var MODE_LABEL = { osobne: 'osobní schůzka', online: 'online video hovor' };
  var PATH_LABEL = { vlastni: 'vlastní kapitál', financovani: 'financování' };
  var MIN_LEAD_MS = 2 * 3600000;
  var CHECK = '<svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg>';

  function dayHead(d) { return DAYS[d.getDay()] + ' ' + d.getDate() + '. ' + MON[d.getMonth()]; }
  function hhmm(d) { return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function weekStart(offset) { var m = startOfDay(new Date()); m.setDate(m.getDate() - ((m.getDay() + 6) % 7) + 7 * offset); return m; }

  function mount(root) {
    var token = new URLSearchParams(location.search).get('t') || '';
    var path = root.getAttribute('data-path') || new URLSearchParams(location.search).get('path') || '';
    if (!PATH_LABEL[path]) path = '';
    var chosenMode = '', week = 0, slotsCache = null;

    root.className = (root.className ? root.className + ' ' : '') + 'bk';
    root.innerHTML =
      '<div class="bk-modes-wrap">' +
        '<h2 class="bk-h">Jak vám to <span class="g">vyhovuje?</span></h2>' +
        '<p class="bk-sub">Vyberte formu a hned uvidíte volné termíny.</p>' +
        '<div class="bk-modes">' +
          '<button type="button" class="bk-mode" data-mode="online"><svg viewBox="0 0 24 24"><rect x="3" y="6" width="12" height="12" rx="2"/><path d="M15 10l6-3v10l-6-3z"/></svg>Online<small>video hovor z pohodlí domova</small></button>' +
          '<button type="button" class="bk-mode" data-mode="osobne"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>Osobně<small>u nás nebo u vás</small></button>' +
        '</div>' +
      '</div>' +
      '<div class="bk-cal" style="display:none">' +
        '<button type="button" class="bk-back">← změnit formu schůzky</button>' +
        '<h2 class="bk-h">Vyberte <span class="g">termín</span></h2>' +
        '<p class="bk-sub bk-modelbl"></p>' +
        '<div class="bk-tabs"><button type="button" class="bk-tab on" data-week="0">Tento týden</button><button type="button" class="bk-tab" data-week="1">Příští týden</button></div>' +
        '<div class="bk-range"></div>' +
        '<div class="bk-week"></div>' +
        '<div class="bk-empty" style="display:none"></div>' +
      '</div>' +
      '<div class="bk-done" style="display:none"></div>' +
      '<div class="bk-status" role="status" aria-live="polite"></div>' +
      '<p class="bk-foot">Nezávazně a zdarma · 17,5 minuty · Počet partnerů je omezený</p>';

    var elModes = root.querySelector('.bk-modes-wrap'), elCal = root.querySelector('.bk-cal'), elDone = root.querySelector('.bk-done');
    var elWeek = root.querySelector('.bk-week'), elEmpty = root.querySelector('.bk-empty'), elRange = root.querySelector('.bk-range');
    var elStatus = root.querySelector('.bk-status'), elFoot = root.querySelector('.bk-foot'), elModeLbl = root.querySelector('.bk-modelbl');

    function setStatus(msg, err) { elStatus.style.color = err ? '#ff8f8f' : '#4aa3ea'; elStatus.textContent = msg || ''; }
    function show(which) {
      elModes.style.display = which === 'modes' ? '' : 'none';
      elCal.style.display = which === 'cal' ? '' : 'none';
      elDone.style.display = which === 'done' ? '' : 'none';
      elFoot.style.display = which === 'done' ? 'none' : '';
      var intro = document.getElementById('intro'); if (intro) intro.style.display = which === 'modes' ? '' : 'none';
    }

    root.querySelectorAll('.bk-mode').forEach(function (b) {
      b.addEventListener('click', function () {
        chosenMode = b.getAttribute('data-mode') || 'online'; week = 0;
        root.querySelectorAll('.bk-tab').forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-week') === '0'); });
        elModeLbl.textContent = MODE_LABEL[chosenMode] + (path ? ' · ' + PATH_LABEL[path] : '');
        show('cal'); setStatus(''); loadSlots();
        root.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    });
    root.querySelector('.bk-back').addEventListener('click', function () { show('modes'); setStatus(''); });
    root.querySelectorAll('.bk-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        week = parseInt(t.getAttribute('data-week'), 10) || 0;
        root.querySelectorAll('.bk-tab').forEach(function (x) { x.classList.toggle('on', x === t); });
        render();
      });
    });

    function loadSlots() {
      setStatus('Načítám volné termíny…'); elWeek.innerHTML = ''; elEmpty.style.display = 'none';
      fetch('/api/compounder/meeting-slots?days=15', { credentials: 'include' })
        .then(function (r) { return r.json(); })
        .then(function (slots) { setStatus(''); slotsCache = Array.isArray(slots) ? slots : []; render(); })
        .catch(function () { setStatus('Nepodařilo se načíst termíny. Zkuste to prosím znovu.', true); });
    }

    function render() {
      var now = new Date(), minStart = new Date(now.getTime() + MIN_LEAD_MS);
      var mon = weekStart(week), sun = new Date(mon); sun.setDate(mon.getDate() + 7);
      var last = new Date(sun); last.setDate(last.getDate() - 1);
      elRange.textContent = mon.getDate() + '. ' + MON[mon.getMonth()] + ' – ' + last.getDate() + '. ' + MON[last.getMonth()];
      var wk = (slotsCache || []).filter(function (s) { var d = new Date(s.starts_at); return d >= mon && d < sun && d >= minStart; });
      var byDay = {}; wk.forEach(function (s) { var k = new Date(s.starts_at).toDateString(); (byDay[k] = byDay[k] || []).push(s); });
      var today = now.toDateString(), html = '';
      for (var i = 0; i < 7; i++) {
        var d = new Date(mon); d.setDate(mon.getDate() + i); var k = d.toDateString();
        var list = (byDay[k] || []).sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); });
        var cls = 'bk-d' + (k === today ? ' today' : '') + (d < startOfDay(now) ? ' past' : '');
        html += '<div class="' + cls + '"><div class="bk-dh"><span class="dn">' + DN[d.getDay()] + '</span><span class="dd">' + d.getDate() + '.</span></div>';
        if (!list.length) html += '<div class="bk-none">—</div>';
        list.forEach(function (s) { html += '<button type="button" class="bk-slot" data-id="' + s.id + '">' + hhmm(new Date(s.starts_at)) + '</button>'; });
        html += '</div>';
      }
      elWeek.innerHTML = html;
      if (!wk.length) {
        var otherHas = (slotsCache || []).some(function (s) { var d = new Date(s.starts_at); var m2 = weekStart(week ? 0 : 1), s2 = new Date(m2); s2.setDate(m2.getDate() + 7); return d >= m2 && d < s2 && d >= minStart; });
        elEmpty.textContent = week === 0
          ? (otherHas ? 'Tento týden už máme plno — podívejte se na příští týden.' : 'Tento týden už máme plno. Ozveme se vám s nejbližším volným termínem.')
          : (otherHas ? 'Příští týden zatím nemáme vypsané termíny — zkuste tento týden.' : 'Příští týden zatím nemáme vypsané termíny. Ozveme se vám s nejbližším volným.');
        elEmpty.style.display = '';
      } else elEmpty.style.display = 'none';
      elWeek.querySelectorAll('.bk-slot').forEach(function (b) { b.addEventListener('click', function () { book(parseInt(b.getAttribute('data-id'), 10)); }); });
    }

    function renderDone(r, justBooked) {
      var dt = new Date(r.starts_at);
      elDone.innerHTML =
        '<div class="ic">' + CHECK + '</div>' +
        '<h3>' + (justBooked ? 'Máte rezervováno' : 'Už máte rezervovaný termín') + '</h3>' +
        '<p>' + (justBooked ? 'Těšíme se na vás ' : '') + '<b>' + dayHead(dt) + ' v ' + hhmm(dt) + '</b>' + (justBooked ? '. Potvrzení vám pošleme.' : '.') + '</p>' +
        '<div class="chips">' + (r.mode ? '<span class="bk-chip">' + (r.mode === 'online' ? '💻 ' : '👤 ') + MODE_LABEL[r.mode] + '</span>' : '') +
          (r.financing_path ? '<span class="bk-chip">' + (r.financing_path === 'vlastni' ? '💰 ' : '🏦 ') + PATH_LABEL[r.financing_path] + '</span>' : '') + '</div>' +
        '<button type="button" class="bk-change">Změnit termín</button>';
      elDone.querySelector('.bk-change').addEventListener('click', function () { show('modes'); setStatus(''); });
      show('done');
    }

    function book(slotId) {
      if (!token) { setStatus('Odkaz nemá platný identifikátor. Otevřete prosím odkaz z SMS.', true); return; }
      var payload = { slot_id: slotId, t: token, mode: chosenMode, path: path || undefined };
      elWeek.querySelectorAll('.bk-slot').forEach(function (x) { x.disabled = true; });
      setStatus('Rezervuji termín…');
      fetch('/api/compounder/meeting-reservation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          if (d && d.ok) { setStatus(''); renderDone(d, true); root.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
          else { setStatus((d && d.error) || 'Rezervaci se nepodařilo dokončit. Zkuste to prosím znovu.', true); elWeek.querySelectorAll('.bk-slot').forEach(function (x) { x.disabled = false; }); }
        })
        .catch(function () { setStatus('Rezervaci se nepodařilo dokončit. Zkuste to prosím znovu.', true); elWeek.querySelectorAll('.bk-slot').forEach(function (x) { x.disabled = false; }); });
    }

    // Už má rezervaci? Ukázat ji místo výběru (jeden lead = jeden termín).
    show('modes');
    if (token) {
      fetch('/api/compounder/meeting-reservation?t=' + encodeURIComponent(token), { credentials: 'include' })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d && d.reservation) renderDone(d.reservation, false); })
        .catch(function () {});
    }
  }

  var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  document.querySelectorAll('[data-booking]').forEach(mount);
})();
