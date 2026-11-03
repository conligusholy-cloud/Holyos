// Laundromats — klient videohovoru (návštěvník i Jan/Tomáš). WebRTC + SSE signalizace + chat.
// Funguje v iOS Safari, Android Chrome, Windows/Mac (Chrome, Edge, Firefox, Safari).
(function () {
  'use strict';
  var VC = window.VC || {}; var role = VC.role; var $ = function (id) { return document.getElementById(id); };
  var room = VC.room || null, key = VC.k || null, es = null, pc = null, local = null, ice = null, pendingCand = [], peerName = '', myName = VC.me || '';
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var hm = function (t) { var d = new Date(t); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };

  function send(type, extra) {
    var b = Object.assign({ role: role, k: key, type: type }, extra || {});
    return fetch('/api/vc/' + room + '/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), keepalive: true }).then(function (r) { return r.json().catch(function () { return {}; }); });
  }
  // ── chat ──
  var shown = {};
  function addMsg(m) {
    var id = m.at + ':' + m.from + ':' + m.text.length; if (shown[id]) return; shown[id] = 1;
    var box = $('vc-msgs'); if (!box) return;
    var el = document.createElement('div'); el.className = 'vc-m' + (m.from === role ? ' me' : '');
    el.innerHTML = '<small>' + esc(m.from === role ? 'Vy' : m.name) + ' · ' + hm(m.at) + '</small>' + esc(m.text);
    box.appendChild(el); box.scrollTop = box.scrollHeight;
    if (m.from !== role && document.hidden) try { document.title = '💬 ' + m.name; } catch (e) {}
  }
  function sys(t) { var box = $('vc-msgs'); if (!box) return; var el = document.createElement('div'); el.className = 'vc-sys'; el.textContent = t; box.appendChild(el); box.scrollTop = box.scrollHeight; }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) document.title = 'Videohovor · Laundromats'; });
  var form = $('vc-form');
  if (form) form.addEventListener('submit', function (e) { e.preventDefault(); var i = $('vc-text'), t = i.value.trim(); if (!t || !room) return; i.value = ''; send('chat', { text: t }); });

  // ── média ──
  function getMedia(wantVideo) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve(null);
    var v = wantVideo ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false;
    return navigator.mediaDevices.getUserMedia({ video: v, audio: { echoCancellation: true, noiseSuppression: true } })
      .catch(function () { return wantVideo ? navigator.mediaDevices.getUserMedia({ audio: true }).catch(function () { return null; }) : null; });
  }
  function showLocal() {
    var lv = $('vc-loc'); if (!lv) return;
    if (local && local.getVideoTracks().length) { lv.srcObject = local; lv.style.display = ''; } else lv.style.display = 'none';
    $('vc-bar').style.display = '';
    $('vc-mic').classList.toggle('off', !local || !local.getAudioTracks().some(function (t) { return t.enabled; }));
    $('vc-cam').classList.toggle('off', !local || !local.getVideoTracks().some(function (t) { return t.enabled; }));
    if (local && local.getVideoTracks().length && navigator.mediaDevices.enumerateDevices) navigator.mediaDevices.enumerateDevices().then(function (d) { if (d.filter(function (x) { return x.kind === 'videoinput'; }).length > 1) $('vc-flip').style.display = ''; });
  }
  function getIce() { if (ice) return Promise.resolve(ice); return fetch('/api/vc/ice').then(function (r) { return r.json(); }).then(function (j) { ice = j.iceServers || []; return ice; }).catch(function () { ice = [{ urls: 'stun:stun.l.google.com:19302' }]; return ice; }); }
  function newPc(withTracks) {
    if (pc) { try { pc.close(); } catch (e) {} }
    pendingCand = [];
    pc = new RTCPeerConnection({ iceServers: ice });
    if (local && withTracks) local.getTracks().forEach(function (t) { pc.addTrack(t, local); });
    pc.onicecandidate = function (e) { if (e.candidate) send('signal', { data: { candidate: e.candidate } }); };
    pc.ontrack = function (e) { var rv = $('vc-rem'); if (rv.srcObject !== e.streams[0]) { rv.srcObject = e.streams[0]; } $('vc-ph').style.display = 'none'; var p = rv.play(); if (p && p.catch) p.catch(function () { tapToPlay(); }); };
    pc.onconnectionstatechange = function () {
      var s = pc.connectionState;
      if (s === 'connected') sys('Spojení navázáno.');
      if (s === 'failed') { sys('Spojení se nepodařilo – zkouším znovu…'); if (role === 'agent') setTimeout(offer, 1500); }
      if (s === 'disconnected') sys('Spojení vypadává…');
    };
    return pc;
  }
  function tapToPlay() { var ph = $('vc-ph'); ph.style.display = ''; ph.innerHTML = '<button class="btn" id="vc-play">▶ Klepnutím spustit zvuk a obraz</button>'; $('vc-play').onclick = function () { $('vc-rem').play(); ph.style.display = 'none'; }; }
  function offer() {
    return getIce().then(function () {
      newPc(true);
      if (!local || !local.getVideoTracks().length) pc.addTransceiver('video', { direction: local ? 'sendrecv' : 'recvonly' });
      if (!local || !local.getAudioTracks().length) pc.addTransceiver('audio', { direction: 'recvonly' });
      return pc.createOffer();
    }).then(function (o) { return pc.setLocalDescription(o); }).then(function () { send('signal', { data: { sdp: pc.localDescription } }); });
  }
  function onSignal(d) {
    if (!d) return;
    if (d.sdp) {
      var go = d.sdp.type === 'offer' ? getIce().then(function () { newPc(false); }) : Promise.resolve();
      go.then(function () { return pc.setRemoteDescription(d.sdp); }).then(function () {
        pendingCand.splice(0).forEach(function (c) { pc.addIceCandidate(c).catch(function () {}); });
        if (d.sdp.type === 'offer' && local) local.getTracks().forEach(function (t) { pc.addTrack(t, local); });
        if (d.sdp.type === 'offer') return pc.createAnswer().then(function (a) { return pc.setLocalDescription(a); }).then(function () { send('signal', { data: { sdp: pc.localDescription } }); });
      }).catch(function (e) { sys('Chyba spojení: ' + e.message); });
    } else if (d.candidate) {
      if (pc && pc.remoteDescription && pc.remoteDescription.type) pc.addIceCandidate(d.candidate).catch(function () {}); else pendingCand.push(d.candidate);
    }
  }
  // ── tlačítka ──
  function bindBar() {
    $('vc-mic').onclick = function () { if (!local) return; local.getAudioTracks().forEach(function (t) { t.enabled = !t.enabled; }); showLocal(); };
    $('vc-cam').onclick = function () {
      if (!local || !local.getVideoTracks().length) { // kamera zatím nebyla povolená → zkusit znovu
        getMedia(true).then(function (s) { if (!s) return sys('Kameru se nepodařilo zapnout. Povolte ji v nastavení prohlížeče.'); local = s; showLocal(); if (role === 'visitor') send('ready', { video: true, audio: true }); else offer(); });
        return;
      }
      local.getVideoTracks().forEach(function (t) { t.enabled = !t.enabled; }); showLocal();
    };
    $('vc-flip').onclick = function () {
      if (!local) return; var cur = local.getVideoTracks()[0]; var fm = cur && cur.getSettings && cur.getSettings().facingMode === 'environment' ? 'user' : 'environment';
      navigator.mediaDevices.getUserMedia({ video: { facingMode: fm } }).then(function (s) {
        var nt = s.getVideoTracks()[0]; if (cur) { local.removeTrack(cur); cur.stop(); } local.addTrack(nt);
        if (pc) pc.getSenders().forEach(function (snd) { if (snd.track && snd.track.kind === 'video') snd.replaceTrack(nt).catch(function () {}); });
        showLocal(); $('vc-loc').style.transform = fm === 'user' ? 'scaleX(-1)' : 'none';
      }).catch(function () {});
    };
    $('vc-end').onclick = function () { if (!confirm('Ukončit hovor?')) return; send('hangup'); end('Hovor jste ukončili.'); };
  }
  function end(t) {
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    if (local) { local.getTracks().forEach(function (x) { x.stop(); }); local = null; }
    var ph = $('vc-ph'); ph.style.display = ''; ph.innerHTML = '<div class="big">' + esc(t) + '</div><div>Chat níže zůstává k dispozici, dokud stránku nezavřete.</div>';
    $('vc-rem').srcObject = null; $('vc-loc').style.display = 'none'; $('vc-bar').style.display = 'none';
  }
  // ── výzva návštěvníkovi: zapnout kameru a mikrofon ──
  function askVisitorMedia(name) {
    if (document.getElementById('vc-ask')) return;
    var ov = document.createElement('div'); ov.className = 'vc-ov'; ov.id = 'vc-ask';
    ov.innerHTML = '<div class="card"><div class="vc-pulse" style="margin:0 auto 12px">🎥</div><h2 style="margin:0 0 6px">' + esc(name) + ' se připojil</h2><p class="muted" style="margin:0 0 6px">Zapněte prosím kameru a mikrofon, ať se slyšíme a vidíme. Prohlížeč se vás zeptá na povolení – zvolte <b>Povolit</b>.</p>'
      + '<button class="btn" id="vc-a1">🎥 Zapnout kameru a mikrofon</button><button class="btn sec" id="vc-a2">🎙️ Jen mikrofon</button><button class="btn sec" id="vc-a3">💬 Jen chat / jen se dívat</button></div>';
    document.body.appendChild(ov);
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
    function go(video, audio) {
      ov.remove();
      (audio ? getMedia(video) : Promise.resolve(null)).then(function (s) {
        local = s; showLocal();
        if (audio && !s) sys('Kamera ani mikrofon nejsou povolené – hovor uvidíte a uslyšíte, psát můžete do chatu. Povolit je jde i později tlačítkem 📷.');
        send('ready', { video: !!(s && s.getVideoTracks().length), audio: !!(s && s.getAudioTracks().length) });
      });
    }
    $('vc-a1').onclick = function () { go(true, true); }; $('vc-a2').onclick = function () { go(false, true); }; $('vc-a3').onclick = function () { go(false, false); };
  }
  // ── události ze serveru ──
  var agentJoined = false, visitorReady = null;
  function connect() {
    es = new EventSource('/api/vc/' + room + '/events?role=' + role + '&k=' + encodeURIComponent(key));
    es.onmessage = function (e) {
      var m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.type === 'state') {
        (m.room.msgs || []).forEach(addMsg);
        if (role === 'visitor' && m.room.agent && !agentJoined) { agentJoined = true; peerName = m.room.agent; $('vc-tag').textContent = m.room.agent; $('vc-tag').style.display = ''; sys(m.room.agent + ' se připojil k hovoru.'); askVisitorMedia(m.room.agent); }
        if (role === 'agent') { peerName = m.room.visitor.name; if (m.room.vready) visitorReady = m.room.vready; }
      } else if (m.type === 'chat') addMsg(m.msg);
      else if (m.type === 'signal') onSignal(m.data);
      else if (m.type === 'visitor_ready' && role === 'agent') { visitorReady = m.media; sys(peerName + (m.media.video ? ' zapnul kameru.' : m.media.audio ? ' zapnul mikrofon.' : ' zůstává jen u chatu.')); if (joined) offer(); }
      else if (m.type === 'hangup') { if (m.by !== role) { sys((m.name || 'Druhá strana') + ' ukončil hovor.'); end('Hovor skončil.'); } }
      else if (m.type === 'peer_offline') { if (m.role !== role) sys((role === 'agent' ? peerName || 'Zákazník' : peerName || 'Druhá strana') + ' zavřel stránku nebo ztratil spojení.'); }
      else if (m.type === 'peer_online') { if (m.role !== role && role === 'agent' && joined) setTimeout(function () { if (visitorReady) offer(); }, 800); }
    };
  }
  // ── návštěvník ──
  var joined = false;
  if (role === 'visitor') {
    var f = $('vc-start');
    f.addEventListener('submit', function (e) {
      e.preventDefault(); var d = {}; new FormData(f).forEach(function (v, k) { d[k] = v; });
      var b = f.querySelector('button'); b.disabled = true; b.textContent = 'Spojuji…'; var er = $('vc-err'); er.style.display = 'none';
      fetch('/api/vc/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) throw new Error(j.error || 'Spojení se nepodařilo.');
        room = j.room; key = j.key; f.style.display = 'none'; $('vc-call').style.display = ''; bindBar();
        sys('Žádost odeslána – upozornili jsme kompetentní osobu. Obvykle se připojí do pár minut.');
        connect();
        setTimeout(function () { if (!agentJoined) sys('Zatím se nikdo nepřipojil. Napište nám prosím do chatu, s čím potřebujete poradit – zprávu uvidíme a ozveme se, případně zavoláme na váš telefon.'); }, 180000);
        window.addEventListener('beforeunload', function () { if (agentJoined) send('hangup'); });
      }).catch(function (x) { b.disabled = false; b.textContent = '🎥 Spojit se teď'; er.textContent = x.message; er.style.display = ''; });
    });
  }
  // ── Jan / Tomáš ──
  if (role === 'agent') {
    bindBar(); connect(); $('vc-bar').style.display = 'none';
    $('vc-join').onclick = function () {
      var b = this; b.disabled = true; b.textContent = 'Zapínám kameru…';
      getMedia(true).then(function (s) {
        local = s; return send('join');
      }).then(function (j) {
        if (j && j.taken) { b.textContent = 'Hovor už přijal ' + j.taken; if (local) local.getTracks().forEach(function (t) { t.stop(); }); local = null; return; }
        joined = true; b.style.display = 'none'; showLocal();
        $('vc-ph').innerHTML = '<div class="big">Čekáme na zákazníka…</div><div>Zákazníkovi teď vyskočila výzva k zapnutí kamery a mikrofonu.</div>';
        if (!local) sys('Kamera ani mikrofon nejsou povolené – zákazník vás neuvidí ani neuslyší. Povolte je v nastavení prohlížeče.');
        if (visitorReady) offer();
      });
    };
  }
})();
