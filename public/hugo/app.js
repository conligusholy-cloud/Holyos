// =============================================================================
// Hugo — partner-facing AI servisní asistent (bestseries.cash/hugo)
// Mobile-first SPA, vanilla JS, žádné frameworky.
// Auth: httpOnly cookie `hugo_token` (s fallbackem na localStorage bearer pro PWA).
// =============================================================================

(function () {
  'use strict';

  // ─── i18n shortcut ───────────────────────────────────────────────────────
  const t = (k) => (window.HugoI18n ? window.HugoI18n.t(k) : k);

  // ─── State ────────────────────────────────────────────────────────────────

  const State = {
    partner: null,
    view: 'login', // login | chat | guides | article | profile
    sessionId: null,
    messages: [], // { id, role, body, retrieved?, citations?, feedback? }
    sending: false,
    guides: null,
    articleView: null,
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
      // Pokud má partner v profilu jazyk a lišil by se od aktuálního, použij ten z profilu.
      if (me.language && window.HugoI18n && me.language !== window.HugoI18n.getLang()) {
        window.HugoI18n.setLang(me.language);
      }
      State.view = 'chat';
    } catch (_) {
      State.view = 'login';
    }
    render();
  }

  // Změna jazyka — uloží se do localStorage i na backend (best-effort)
  async function changeLanguage(code) {
    if (!window.HugoI18n) return;
    window.HugoI18n.setLang(code);
    // Pokud je partner přihlášený, ulož i do jeho profilu (Hugo pak odpovídá v tom jazyce)
    if (State.partner) {
      try {
        await api('/api/hugo/me', { method: 'PATCH', body: { language: code } });
        State.partner.language = code;
      } catch (_) { /* tichý fail, UI funguje i bez serveru */ }
    }
    render();
  }

  function showLanguageMenu() {
    if (!window.HugoI18n) return;
    const overlay = document.createElement('div');
    overlay.className = 'lang-menu';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const inner = document.createElement('div');
    inner.className = 'lang-menu-inner';
    inner.innerHTML = `<div class="lang-menu-title">${t('profile.language') || 'Language'}</div>`;
    overlay.appendChild(inner);

    const cur = window.HugoI18n.getLang();
    window.HugoI18n.listLangs().forEach(L => {
      const btn = document.createElement('button');
      btn.className = 'lang-item' + (L.code === cur ? ' active' : '');
      btn.innerHTML = `<span class="flag">${window.HugoI18n.flagImg(L, 28)}</span><span>${escapeHtml(L.name)}</span>`;
      btn.addEventListener('click', async () => {
        overlay.remove();
        await changeLanguage(L.code);
      });
      inner.appendChild(btn);
    });
    document.body.appendChild(overlay);
  }

  function langButtonHtml() {
    if (!window.HugoI18n) return '';
    const cur = window.HugoI18n.getLang();
    const L = window.HugoI18n.listLangs().find(x => x.code === cur);
    if (!L) return '';
    return `<button class="lang-btn" id="lang-btn" title="${escapeHtml(L.name)}">${window.HugoI18n.flagImg(L, 22)} <span class="caret">▾</span></button>`;
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
      <div style="display:flex; padding:14px 14px 0; padding-top:max(14px, env(safe-area-inset-top));">
        ${langButtonHtml()}
      </div>
      <div class="login-wrap">
        <div class="login-hero">
          <div class="logo-big">🔧</div>
          <h1>Hugo</h1>
          <p>${t('app.tagline')}<br>${t('app.tagline2')}</p>
        </div>
        <div class="login-card">
          <div class="field">
            <label>${t('login.username')}</label>
            <input id="login-username" autocomplete="username" autocapitalize="none" autocorrect="off">
          </div>
          <div class="field">
            <label>${t('login.password')}</label>
            <input id="login-password" type="password" autocomplete="current-password">
          </div>
          <button class="login-btn" id="login-btn">${t('login.submit')}</button>
          <div class="login-error" id="login-error" style="display:none"></div>
        </div>
        <div class="login-foot">
          ${t('login.footer')}<br>
          ${t('login.no_account')} <a href="mailto:servis@bestseries.cz" style="color:var(--accent)">servis@bestseries.cz</a>.
        </div>
      </div>
    `;
    const langBtn = document.getElementById('lang-btn');
    if (langBtn) langBtn.addEventListener('click', showLanguageMenu);
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
      btn.textContent = t('login.submitting');
      try {
        const r = await fetch('/api/hugo/auth/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: uname.value.trim(), password: pwd.value }),
        });
        const data = await r.json();
        if (!r.ok) { throw new Error(data.error || t('login.bad_credentials')); }
        if (data.token) setBearer(data.token);
        await bootstrap();
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = t('login.submit');
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
          <div class="hugo-tag">${escapeHtml(State.partner?.company?.name || State.partner?.display_name || t('chat.tagline_default'))}</div>
        </div>
        ${langButtonHtml()}
        <button class="hugo-menu" id="new-chat-btn" title="${t('chat.new_confirm')}" style="margin-left:8px;">＋</button>
      </div>
      <div class="hugo-content">
        <div class="chat-wrap">
          <div class="chat-list" id="chat-list"></div>
        </div>
      </div>
      <div class="chat-input">
        <textarea id="chat-text" placeholder="${t('chat.placeholder')}" rows="1"></textarea>
        <button class="send-btn" id="send-btn" title="Send">→</button>
      </div>
      ${bottomNavHtml('chat')}
    `;
    attachBottomNav();
    const langBtn = document.getElementById('lang-btn');
    if (langBtn) langBtn.addEventListener('click', showLanguageMenu);
    const list = document.getElementById('chat-list');
    const text = document.getElementById('chat-text');
    const sendBtn = document.getElementById('send-btn');
    const newBtn = document.getElementById('new-chat-btn');

    function rerender() {
      list.innerHTML = '';
      if (!State.messages.length && !State.sending) {
        // Prázdný stav — jen pozdrav, žádné suggestion chips (uživatel je nechce).
        list.innerHTML = `
          <div class="chat-empty">
            <div class="b">👋</div>
            <div>${t('chat.empty_hello')}</div>
          </div>
        `;
      } else {
        State.messages.forEach(m => list.appendChild(messageBubble(m)));
        if (State.sending) {
          const node = document.createElement('div');
          node.className = 'msg-row assistant';
          node.innerHTML = `<div class="msg-bubble"><span class="typing">${t('chat.thinking')}</span></div>`;
          list.appendChild(node);
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
      if (State.messages.length && !confirm(t('chat.new_confirm'))) return;
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
      helpful.textContent = t('chat.helpful');
      helpful.addEventListener('click', async () => {
        try { await api('/api/hugo/messages/' + m.id + '/feedback', { method: 'POST', body: { feedback: 'helpful' } }); m.feedback = 'helpful'; render(); } catch (_) {}
      });
      const notHelpful = document.createElement('button');
      notHelpful.className = 'fb-btn' + (m.feedback === 'not_helpful' ? ' active' : '');
      notHelpful.textContent = t('chat.not_helpful');
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
          <div class="hugo-name">${t('guides.title')}</div>
          <div class="hugo-tag">${t('guides.subtitle')}</div>
        </div>
        ${langButtonHtml()}
      </div>
      <div class="hugo-content">
        <div class="guides-wrap">
          <input class="guides-search" id="guides-q" placeholder="${t('guides.search')}">
          <div id="guides-list">${t('article.loading')}</div>
        </div>
      </div>
      ${bottomNavHtml('guides')}
    `;
    attachBottomNav();
    const langBtn = document.getElementById('lang-btn');
    if (langBtn) langBtn.addEventListener('click', showLanguageMenu);

    const listEl = document.getElementById('guides-list');
    const searchEl = document.getElementById('guides-q');
    let lastTimer = null;

    async function refresh(q) {
      try {
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        const items = await api('/api/hugo/articles?' + params.toString());
        if (!items.length) {
          listEl.innerHTML = `<div class="chat-empty"><div class="b">📭</div>${t('guides.empty')}</div>`;
          return;
        }
        // Kindy zatím necháváme univerzálně (rozumějí všichni). Lze později rozšířit.
        const kindLabels = { GUIDE: 'Guide', CASE: 'Case', CHECKLIST: 'Checklist', FAQ: 'FAQ' };
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
          <button class="back-btn" id="back-btn">${t('article.back')}</button>
          ${a ? `
            <h1>${escapeHtml(a.title)}</h1>
            ${a.summary ? '<p style="color:var(--text2);font-style:italic;">' + escapeHtml(a.summary) + '</p>' : ''}
            <div>${mdToHtml(a.body_md)}</div>
            ${a.attachments && a.attachments.length ? `
              <h2>${t('article.attachments')}</h2>
              <ul>${a.attachments.map(at => `<li><a href="${escapeHtml(at.url || at.file_path || '#')}" target="_blank">${escapeHtml(at.title)}</a></li>`).join('')}</ul>
            ` : ''}
          ` : `<div class="chat-empty">${t('article.loading')}</div>`}
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
    const dash = t('common.dash') || '—';
    const productList = (p.products || []).map(pr => `#${pr.product_id}${pr.serial_no ? ' (' + pr.serial_no + ')' : ''}`).join(', ') || dash;
    const curLang = (window.HugoI18n && window.HugoI18n.getLang()) || 'cs';
    const curLangObj = window.HugoI18n && window.HugoI18n.listLangs().find(l => l.code === curLang);
    const curLangLabel = curLangObj ? `${window.HugoI18n.flagImg(curLangObj, 22)} ${escapeHtml(curLangObj.name)}` : curLang;
    root.innerHTML = `
      <div class="hugo-top">
        <div class="hugo-logo">👤</div>
        <div>
          <div class="hugo-name">${escapeHtml(p.display_name || dash)}</div>
          <div class="hugo-tag">${escapeHtml(p.company?.name || p.username || '')}</div>
        </div>
      </div>
      <div class="hugo-content">
        <div class="profile-wrap">
          <div class="profile-row"><div><div class="label">${t('profile.username')}</div><div class="value">${escapeHtml(p.username || dash)}</div></div></div>
          <div class="profile-row"><div><div class="label">${t('profile.email')}</div><div class="value">${escapeHtml(p.email || dash)}</div></div></div>
          <div class="profile-row"><div><div class="label">${t('profile.phone')}</div><div class="value">${escapeHtml(p.phone || dash)}</div></div></div>
          <div class="profile-row"><div><div class="label">${t('profile.company')}</div><div class="value">${escapeHtml(p.company?.name || dash)}</div></div></div>
          <div class="profile-row"><div><div class="label">${t('profile.products')}</div><div class="value">${escapeHtml(productList)}</div></div></div>
          <button class="profile-row" id="lang-row" style="border:1px solid var(--border); width:100%; cursor:pointer;">
            <div style="text-align:left;"><div class="label">${t('profile.language')}</div><div class="value">${curLangLabel}</div></div>
            <div style="opacity:0.5; font-size:18px;">›</div>
          </button>
          <button class="logout-btn" id="logout-btn">${t('profile.logout')}</button>
        </div>
      </div>
      ${bottomNavHtml('profile')}
    `;
    attachBottomNav();
    document.getElementById('lang-row').addEventListener('click', showLanguageMenu);
    document.getElementById('logout-btn').addEventListener('click', async () => {
      if (!confirm(t('profile.logout_confirm'))) return;
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
        <button class="bn-item ${active === 'chat' ? 'active' : ''}" data-view="chat"><span class="ico">💬</span>${t('nav.chat')}</button>
        <button class="bn-item ${active === 'guides' ? 'active' : ''}" data-view="guides"><span class="ico">📚</span>${t('nav.guides')}</button>
        <button class="bn-item ${active === 'profile' ? 'active' : ''}" data-view="profile"><span class="ico">👤</span>${t('nav.profile')}</button>
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
