// =============================================================================
// Hugo — partner-facing AI servisní asistent (bestseries.cash/hugo)
// Mobile-first SPA, vanilla JS, žádné frameworky.
// Auth: httpOnly cookie `hugo_token` (s fallbackem na localStorage bearer pro PWA).
// =============================================================================

(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────

  const State = {
    partner: null,
    view: 'login', // login | chat | guides | article | profile
    sessionId: null,
    messages: [], // { id, role, body, retrieved?, citations?, feedback? }
    sending: false,
    guides: null, // {kind: [...]} groupped
    articleView: null, // article object
  };

  // localStorage token fallback (pokud httpOnly cookie nefunguje, např. cross-domain PWA)
  function getBearer() { return localStorage.getItem('hugo_token'); }
  function setBearer(t) { if (t) localStorage.setItem('hugo_token', t); }
  function clearBearer() { localStorage.removeItem('hugo_token'); }

  // ─── HTTP ─────────────────────────────────────────────────────────────────

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const bearer = getBearer();
    if (bearer) headers['Authorization'] = 'Bearer ' + bearer;
    const resp = await fetch(path, {
      method: opts.method || 'GET',
      headers,
      credentials: 'include',
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (resp.status === 401) {
      clearBearer();
      State.partner = null;
      State.view = 'login';
      render();
      throw new Error('Nepřihlášen');
    }
    if (!resp.ok) {
      let err = null;
      try { err = await resp.json(); } catch (_) {}
      throw new Error((err && err.error) || ('HTTP ' + resp.status));
    }
    return resp.json();
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────────

  async function bootstrap() {
    try {
      const me = await api('/api/hugo/me');
      State.partner = me;
      State.view = 'chat';
    } catch (_) {
      State.view = 'login';
    }
    render();
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  function render() {
    const root = document.getElementById('app');
    if (State.view === 'login') return renderLogin(root);
    if (State.view === 'chat') return renderChat(root);
    if (State.view === 'guides') return renderGuides(root);
    if (State.view === 'article') return renderArticle(root);
    if (State.view === 'profile') return renderProfile(root);
  }

  // ─── LOGIN ───────────────────────────────────────────────────────────────

  function renderLogin(root) {
    root.innerHTML = `
      <div class="login-wrap">
        <div class="login-hero">
          <div class="logo-big">🔧</div>
          <h1>Hugo</h1>
          <p>Tvůj servisní asistent.<br>K dispozici 24/7 pro partnery Best Series.</p>
        </div>
        <div class="login-card">
          <div class="field">
            <label>Přihlašovací jméno</label>
            <input id="login-username" autocomplete="username" autocapitalize="none" autocorrect="off">
          </div>
          <div class="field">
            <label>Heslo</label>
            <input id="login-password" type="password" autocomplete="current-password">
          </div>
          <button class="login-btn" id="login-btn">Přihlásit se</button>
          <div class="login-error" id="login-error" style="display:none"></div>
        </div>
        <div class="login-foot">
          Best Series s.r.o. · Servisní podpora<br>
          Pokud nemáš účet, napiš na <a href="mailto:servis@bestseries.cz" style="color:var(--accent)">servis@bestseries.cz</a>.
        </div>
      </div>
    `;
    const btn = document.getElementById('login-btn');
    const errBox = document.getElementById('login-error');
    const uname = document.getElementById('login-username');
    const pwd = document.getElementById('login-password');

    function showError(msg) {
      errBox.textContent = msg;
      errBox.style.display = 'block';
    }

    async function submit() {
      errBox.style.display = 'none';
      btn.disabled = true;
      btn.textContent = 'Přihlašuji…';
      try {
        const r = await fetch('/api/hugo/auth/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: uname.value.trim(), password: pwd.value }),
        });
        const data = await r.json();
        if (!r.ok) { throw new Error(data.error || 'Přihlášení selhalo'); }
        if (data.token) setBearer(data.token);
        await bootstrap();
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = 'Přihlásit se';
      }
    }
    btn.addEventListener('click', submit);
    pwd.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    setTimeout(() => uname.focus(), 100);
  }

  // ─── CHAT ────────────────────────────────────────────────────────────────

  function renderChat(root) {
    root.innerHTML = `
      <div class="hugo-top">
        <div class="hugo-logo">🔧</div>
        <div>
          <div class="hugo-name">Hugo</div>
          <div class="hugo-tag">${escapeHtml(State.partner?.company?.name || State.partner?.display_name || 'Servisní asistent')}</div>
        </div>
        <button class="hugo-menu" id="new-chat-btn" title="Nová konverzace">＋</button>
      </div>
      <div class="hugo-content">
        <div class="chat-wrap">
          <div class="chat-list" id="chat-list"></div>
        </div>
      </div>
      <div class="chat-input">
        <textarea id="chat-text" placeholder="Napiš, s čím potřebuješ pomoct…" rows="1"></textarea>
        <button class="send-btn" id="send-btn" title="Odeslat">→</button>
      </div>
      ${bottomNavHtml('chat')}
    `;
    attachBottomNav();
    const list = document.getElementById('chat-list');
    const text = document.getElementById('chat-text');
    const sendBtn = document.getElementById('send-btn');
    const newBtn = document.getElementById('new-chat-btn');

    function rerender() {
      list.innerHTML = '';
      if (!State.messages.length && !State.sending) {
        list.innerHTML = `
          <div class="chat-empty">
            <div class="b">👋</div>
            <div>Zeptej se Huga na cokoliv ohledně provozu prádlomatu.</div>
            <div class="chat-suggestions">
              <button class="chat-sug" data-text="Buben dělá divný zvuk při ždímání. Co s tím?">🔊 Buben dělá divný zvuk při ždímání</button>
              <button class="chat-sug" data-text="Displej nesvítí. Jak postupovat?">📺 Displej nesvítí</button>
              <button class="chat-sug" data-text="Stroj nevpouští vodu — co kontrolovat?">💧 Stroj nevpouští vodu</button>
              <button class="chat-sug" data-text="Jaký je doporučený interval údržby?">📅 Interval údržby</button>
            </div>
          </div>
        `;
        list.querySelectorAll('.chat-sug').forEach(btn => {
          btn.addEventListener('click', () => {
            text.value = btn.dataset.text;
            send();
          });
        });
      } else {
        State.messages.forEach(m => list.appendChild(messageBubble(m)));
        if (State.sending) {
          const t = document.createElement('div');
          t.className = 'msg-row assistant';
          t.innerHTML = `<div class="msg-bubble"><span class="typing">Hugo přemýšlí</span></div>`;
          list.appendChild(t);
        }
        list.scrollTop = list.scrollHeight;
      }
    }

    function autoGrow() {
      text.style.height = 'auto';
      text.style.height = Math.min(120, text.scrollHeight) + 'px';
    }

    async function send() {
      const msg = text.value.trim();
      if (!msg || State.sending) return;
      text.value = '';
      autoGrow();
      State.messages.push({ role: 'user', body: msg });
      State.sending = true;
      sendBtn.disabled = true;
      rerender();

      try {
        const r = await api('/api/hugo/chat', { method: 'POST', body: { message: msg, session_id: State.sessionId } });
        State.sessionId = r.session_id;
        State.messages.push({
          id: r.message.id,
          role: 'assistant',
          body: r.message.body,
          retrieved: r.retrieved || [],
        });
      } catch (err) {
        State.messages.push({ role: 'assistant', body: '⚠️ ' + err.message });
      } finally {
        State.sending = false;
        sendBtn.disabled = false;
        rerender();
        text.focus();
      }
    }

    text.addEventListener('input', autoGrow);
    text.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !navigator.userAgent.match(/Mobile|Android|iPhone/i)) {
        e.preventDefault();
        send();
      }
    });
    sendBtn.addEventListener('click', send);
    newBtn.addEventListener('click', () => {
      if (State.messages.length && !confirm('Začít novou konverzaci? Aktuální zůstane v historii.')) return;
      State.sessionId = null;
      State.messages = [];
      rerender();
      text.focus();
    });

    rerender();
    setTimeout(() => text.focus(), 50);
  }

  function messageBubble(m) {
    const row = document.createElement('div');
    row.className = 'msg-row ' + m.role;
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = renderMessageBody(m.body, m.retrieved);
    row.appendChild(bubble);

    if (m.role === 'assistant' && m.retrieved && m.retrieved.length) {
      const cites = document.createElement('div');
      cites.className = 'msg-citations';
      // Zjisti, na které [N] body skutečně odkazoval (max počet retrieved nebo to co Hugo zmínil)
      const refs = Array.from(new Set((m.body.match(/\[(\d+)\]/g) || []).map(s => parseInt(s.slice(1, -1), 10))))
        .filter(n => n >= 1 && n <= m.retrieved.length);
      const articlesToShow = refs.length ? refs.map(n => m.retrieved[n - 1]) : [];
      articlesToShow.forEach(a => {
        const c = document.createElement('button');
        c.className = 'msg-cite';
        c.innerHTML = `📖 ${escapeHtml(a.title)}`;
        c.addEventListener('click', () => openArticle(a.id));
        cites.appendChild(c);
      });
      if (articlesToShow.length) bubble.appendChild(cites);
    }

    if (m.role === 'assistant' && m.id) {
      const fb = document.createElement('div');
      fb.className = 'msg-feedback';
      const helpful = document.createElement('button');
      helpful.className = 'fb-btn' + (m.feedback === 'helpful' ? ' active' : '');
      helpful.textContent = '👍 Pomohlo';
      helpful.addEventListener('click', async () => {
        try { await api('/api/hugo/messages/' + m.id + '/feedback', { method: 'POST', body: { feedback: 'helpful' } }); m.feedback = 'helpful'; render(); } catch (_) {}
      });
      const notHelpful = document.createElement('button');
      notHelpful.className = 'fb-btn' + (m.feedback === 'not_helpful' ? ' active' : '');
      notHelpful.textContent = '👎 Nepomohlo';
      notHelpful.addEventListener('click', async () => {
        try { await api('/api/hugo/messages/' + m.id + '/feedback', { method: 'POST', body: { feedback: 'not_helpful' } }); m.feedback = 'not_helpful'; render(); } catch (_) {}
      });
      fb.appendChild(helpful);
      fb.appendChild(notHelpful);
      bubble.appendChild(fb);
    }

    return row;
  }

  // ─── GUIDES ──────────────────────────────────────────────────────────────

  async function renderGuides(root) {
    root.innerHTML = `
      <div class="hugo-top">
        <div class="hugo-logo">📚</div>
        <div>
          <div class="hugo-name">Návody</div>
          <div class="hugo-tag">Pro tvoje produkty</div>
        </div>
      </div>
      <div class="hugo-content">
        <div class="guides-wrap">
          <input class="guides-search" id="guides-q" placeholder="🔍 Hledat v návodech…">
          <div id="guides-list">Načítám…</div>
        </div>
      </div>
      ${bottomNavHtml('guides')}
    `;
    attachBottomNav();

    const listEl = document.getElementById('guides-list');
    const searchEl = document.getElementById('guides-q');
    let lastTimer = null;

    async function refresh(q) {
      try {
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        const items = await api('/api/hugo/articles?' + params.toString());
        if (!items.length) {
          listEl.innerHTML = `<div class="chat-empty"><div class="b">📭</div>Žádné návody pro tvoje produkty.</div>`;
          return;
        }
        const kindLabels = { GUIDE: 'Návod', CASE: 'Případ', CHECKLIST: 'Kontrola', FAQ: 'FAQ' };
        listEl.innerHTML = items.map(a => `
          <div class="guide-card" data-id="${a.id}">
            <div>
              <span class="guide-kind">${kindLabels[a.kind] || a.kind}</span>
              ${a.category ? '<span class="guide-kind">' + escapeHtml(a.category.icon || '') + ' ' + escapeHtml(a.category.name) + '</span>' : ''}
            </div>
            <h3>${escapeHtml(a.title)}</h3>
            ${a.summary ? '<div class="summary">' + escapeHtml(a.summary) + '</div>' : ''}
          </div>
        `).join('');
        listEl.querySelectorAll('.guide-card').forEach(card => {
          card.addEventListener('click', () => openArticle(parseInt(card.dataset.id, 10)));
        });
      } catch (err) {
        listEl.innerHTML = `<div class="chat-empty">⚠️ ${err.message}</div>`;
      }
    }
    searchEl.addEventListener('input', () => {
      clearTimeout(lastTimer);
      lastTimer = setTimeout(() => refresh(searchEl.value.trim()), 250);
    });
    refresh();
  }

  async function openArticle(id) {
    State.view = 'article';
    State.articleView = null;
    render();
    try {
      const article = await api('/api/hugo/articles/' + id);
      State.articleView = article;
      render();
    } catch (err) {
      alert(err.message);
      State.view = 'guides';
      render();
    }
  }

  function renderArticle(root) {
    const a = State.articleView;
    root.innerHTML = `
      <div class="hugo-content">
        <div class="article-view">
          <button class="back-btn" id="back-btn">← Zpět</button>
          ${a ? `
            <h1>${escapeHtml(a.title)}</h1>
            ${a.summary ? '<p style="color:var(--text2);font-style:italic;">' + escapeHtml(a.summary) + '</p>' : ''}
            <div>${mdToHtml(a.body_md)}</div>
            ${a.attachments && a.attachments.length ? `
              <h2>📎 Přílohy</h2>
              <ul>${a.attachments.map(at => `<li><a href="${escapeHtml(at.url || at.file_path || '#')}" target="_blank">${escapeHtml(at.title)}</a></li>`).join('')}</ul>
            ` : ''}
          ` : '<div class="chat-empty">Načítám…</div>'}
        </div>
      </div>
      ${bottomNavHtml('guides')}
    `;
    attachBottomNav();
    document.getElementById('back-btn').addEventListener('click', () => {
      State.view = 'guides';
      State.articleView = null;
      render();
    });
  }

  // ─── PROFILE ─────────────────────────────────────────────────────────────

  function renderProfile(root) {
    const p = State.partner || {};
    const productList = (p.products || []).map(pr => `#${pr.product_id}${pr.serial_no ? ' (' + pr.serial_no + ')' : ''}`).join(', ') || '—';
    root.innerHTML = `
      <div class="hugo-top">
        <div class="hugo-logo">👤</div>
        <div>
          <div class="hugo-name">${escapeHtml(p.display_name || '—')}</div>
          <div class="hugo-tag">${escapeHtml(p.company?.name || p.username || '')}</div>
        </div>
      </div>
      <div class="hugo-content">
        <div class="profile-wrap">
          <div class="profile-row"><div><div class="label">Username</div><div class="value">${escapeHtml(p.username || '—')}</div></div></div>
          <div class="profile-row"><div><div class="label">Email</div><div class="value">${escapeHtml(p.email || '—')}</div></div></div>
          <div class="profile-row"><div><div class="label">Telefon</div><div class="value">${escapeHtml(p.phone || '—')}</div></div></div>
          <div class="profile-row"><div><div class="label">Firma</div><div class="value">${escapeHtml(p.company?.name || '—')}</div></div></div>
          <div class="profile-row"><div><div class="label">Tvoje produkty</div><div class="value">${escapeHtml(productList)}</div></div></div>
          <button class="logout-btn" id="logout-btn">Odhlásit se</button>
        </div>
      </div>
      ${bottomNavHtml('profile')}
    `;
    attachBottomNav();
    document.getElementById('logout-btn').addEventListener('click', async () => {
      if (!confirm('Opravdu se odhlásit?')) return;
      try { await fetch('/api/hugo/auth/logout', { method: 'POST', credentials: 'include' }); } catch (_) {}
      clearBearer();
      State.partner = null;
      State.view = 'login';
      State.sessionId = null;
      State.messages = [];
      render();
    });
  }

  // ─── Bottom navigation ───────────────────────────────────────────────────

  function bottomNavHtml(active) {
    return `
      <div class="bottom-nav">
        <button class="bn-item ${active === 'chat' ? 'active' : ''}" data-view="chat"><span class="ico">💬</span>Hugo</button>
        <button class="bn-item ${active === 'guides' ? 'active' : ''}" data-view="guides"><span class="ico">📚</span>Návody</button>
        <button class="bn-item ${active === 'profile' ? 'active' : ''}" data-view="profile"><span class="ico">👤</span>Profil</button>
      </div>
    `;
  }
  function attachBottomNav() {
    document.querySelectorAll('.bn-item').forEach(btn => {
      btn.addEventListener('click', () => {
        State.view = btn.dataset.view;
        render();
      });
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function renderMessageBody(text, retrieved) {
    let s = escapeHtml(text);
    // Citace [1], [2]… → klikatelné (interní handling)
    s = s.replace(/\[(\d+)\]/g, (m, n) => {
      const idx = parseInt(n, 10);
      if (retrieved && retrieved[idx - 1]) {
        return `<sup style="color:var(--accent);cursor:pointer" data-cite="${retrieved[idx - 1].id}">[${idx}]</sup>`;
      }
      return m;
    });
    // Bold + odřádkování
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/\n/g, '<br>');
    return s;
  }

  function mdToHtml(md) {
    if (!md) return '';
    let s = escapeHtml(md);
    s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>');
    s = s.replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>').replace(/<\/ul>\s*<ul>/g, '');
    s = s.split(/\n{2,}/).map(p => /^<(h\d|ul|ol|pre)/.test(p.trim()) ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`).join('\n');
    return s;
  }

  // Delegated click handler — citace v Hugově odpovědi
  document.addEventListener('click', e => {
    const cite = e.target.closest('sup[data-cite]');
    if (cite) {
      const id = parseInt(cite.dataset.cite, 10);
      if (id) openArticle(id);
    }
  });

  // ─── Go! ─────────────────────────────────────────────────────────────────

  bootstrap();
})();
