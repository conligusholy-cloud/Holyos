/* ============================================
   sidebar.ts — Shared sidebar navigation
   ============================================ */
export function renderSidebar(activeModule) {
    const modules = [
        { id: 'vytvoreni-arealu', name: 'Vytvoření areálu', icon: '&#9998;', color: '#8b5cf6', active: true },
        { id: 'programovani-vyroby', name: 'Programování výroby', icon: '&#9881;', color: '#f59e0b', active: true },
        { id: 'simulace-vyroby', name: 'Simulace výroby', icon: '&#9654;', color: '#22c55e', active: true },
        { id: 'pracovni-postup', name: 'Pracovní postup', icon: '&#128295;', color: '#06b6d4', active: true },
        { id: 'planovani', name: 'Plánování výroby', icon: '&#128197;', color: '#3b82f6', active: false },
        { id: 'material', name: 'Materiálový tok', icon: '&#128666;', color: '#10b981', active: false },
        { id: 'sklady', name: 'Správa skladů', icon: '&#128230;', color: '#f59e0b', active: false },
        { id: 'reporty', name: 'Reporty a analýzy', icon: '&#128202;', color: '#ef4444', active: false },
        { id: 'nastaveni', name: 'Nastavení', icon: '&#9881;', color: '#6c8cff', active: false },
    ];
    // Compute base path to root
    const basePath = getBasePath();
    const logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="36" height="36">' +
        '<defs><linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">' +
        '<stop offset="0%" style="stop-color:#6C5CE7"/><stop offset="50%" style="stop-color:#0984E3"/><stop offset="100%" style="stop-color:#00B894"/>' +
        '</linearGradient></defs>' +
        '<rect width="100" height="100" rx="22" fill="url(#logoGrad)"/>' +
        '<rect x="22" y="22" width="10" height="56" rx="4" fill="white"/>' +
        '<rect x="68" y="22" width="10" height="56" rx="4" fill="white"/>' +
        '<rect x="32" y="42" width="36" height="10" rx="4" fill="white"/>' +
        '</svg>';
    let html = '' +
        '<div class="sidebar-header">' +
        '<div class="sidebar-logo">' + logoSvg + '</div>' +
        '<div>' +
        '<h1>HOLYOS</h1>' +
        '<p>Řízení výroby</p>' +
        '</div>' +
        '</div>' +
        '<div class="sidebar-label">Moduly</div>' +
        '<nav class="sidebar-nav">';
    modules.forEach((m) => {
        const isActive = m.id === activeModule;
        const cls = 'sidebar-item' + (isActive ? ' active' : '') + (!m.active ? ' disabled' : '');
        // Moduly s výběrovou stránkou (simulace.html) odkazují na ni, ostatní na index.html
        const entryPage = (m.id === 'vytvoreni-arealu' || m.id === 'programovani-vyroby') ? 'simulace.html' : 'index.html';
        const href = m.active ? (basePath + 'modules/' + m.id + '/' + entryPage) : '#';
        const tag = m.active ? '' : '<div class="sidebar-item-tag">Připravuje se</div>';
        html += '<a class="' + cls + '" href="' + href + '">' +
            '<div class="sidebar-icon" style="background:' + m.color + '22; color:' + m.color + ';">' + m.icon + '</div>' +
            '<div class="sidebar-item-info">' +
            '<div class="sidebar-item-name">' + m.name + '</div>' +
            tag +
            '</div>' +
            '</a>';
    });
    html += '</nav>';
    // Přihlášený uživatel + odhlášení
    html += '<div class="sidebar-user">';
    html += '  <div id="sidebar-user-info" style="padding:12px 20px; color:var(--text2); font-size:12px;">Načítám...</div>';
    html += '  <a href="/auth/logout" class="sidebar-item" style="color:var(--text2); font-size:13px;">';
    html += '    <div class="sidebar-icon" style="background:rgba(239,68,68,0.15); color:#ef4444;">&#10005;</div>';
    html += '    <div class="sidebar-item-info"><div class="sidebar-item-name">Odhlásit se</div></div>';
    html += '  </a>';
    html += '</div>';
    // Datový model — úplně dole, oddělený
    const dmActive = activeModule === 'datovy-model';
    const dmCls = 'sidebar-item' + (dmActive ? ' active' : '');
    html += '<a class="' + dmCls + '" href="' + basePath + 'modules/datovy-model/index.html" style="margin-top:auto; opacity:0.6; font-size:12px;">' +
        '<div class="sidebar-icon" style="background:rgba(100,116,139,0.15); color:#64748b;">&#128451;</div>' +
        '<div class="sidebar-item-info"><div class="sidebar-item-name">Datový model</div></div>' +
        '</a>';
    html += '<div class="sidebar-footer">HOLYOS v0.1 — Best Series</div>';
    const sidebar = document.getElementById('sidebar');
    if (sidebar)
        sidebar.innerHTML = html;
    // Načíst info o přihlášeném uživateli
    fetch('/auth/me')
        .then((r) => r.json())
        .then((u) => {
        const el = document.getElementById('sidebar-user-info');
        if (el)
            el.textContent = u.displayName || u.username || '';
        // Pokud je admin, přidat odkaz na správu uživatelů
        if (u.role === 'admin') {
            const nav = document.querySelector('.sidebar-nav');
            if (nav) {
                const adminLink = document.createElement('a');
                adminLink.className = 'sidebar-item' + (activeModule === 'nastaveni' ? ' active' : '');
                adminLink.href = '/admin/users';
                adminLink.innerHTML = '<div class="sidebar-icon" style="background:rgba(108,140,255,0.15); color:#6c8cff;">&#9881;</div>' +
                    '<div class="sidebar-item-info"><div class="sidebar-item-name">Správa uživatelů</div></div>';
                nav.appendChild(adminLink);
            }
        }
    })
        .catch(() => { });
}
/**
 * Compute base path from current location to project root
 */
export function getBasePath() {
    // Always use absolute path to root
    return '/';
}
/**
 * Get path to module editor
 */
export function getEditorPath(simId) {
    const basePath = getBasePath();
    let url = basePath + 'modules/vytvoreni-arealu/index.html';
    if (simId)
        url += '?sim=' + simId;
    return url;
}
/**
 * Init date display
 */
export function initDate() {
    const el = document.getElementById('current-date');
    if (el) {
        const d = new Date();
        el.textContent = d.toLocaleDateString('cs-CZ', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        });
    }
}
//# sourceMappingURL=sidebar.js.map