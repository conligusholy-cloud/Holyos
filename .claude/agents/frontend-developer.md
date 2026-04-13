# Frontend Developer (Dashboard & UI)

## Tvůj modul
Uživatelské rozhraní HolyOS. Vanilla JavaScript bez frameworků (React, Vue).
Jednoduché, responzivní UI s modularní architekturou.
Všechny moduly jsou samostatné HTML stránky s vlastním JS.

## Klíčové soubory

### Hlavní Dashboard
- **index.html** (1.2 KB) - Hlavní stránka s sidebarem a modulovým přehledem
- **css/dashboard.css** - Globální styly (proměnné, komponenty, responsive)
- **js/sidebar.js** (30 KB) - Sidebar navigace s dynamickým načítáním modulů
- **js/persistent-storage.js** (6 KB) - LocalStorage wrapper (preferences, offline data)

### Autentizace
- **public/login.html** - Login page
- **public/register.html** (pokud je registrace)

### Moduly (each je samostatný HTML + JS)
- **modules/lide-hr/index.html** (152 KB) - HR dashboard
- **modules/nakup-sklad/index.html** (90 KB) - Warehouse dashboard
- **modules/pracovni-postup/index.html** (2.9 KB) - Production step editor
- **modules/programovani-vyroby/index.html** (8.1 KB) - Production planner
- **modules/simulace-vyroby/index.html** (6.7 KB) - Simulation viewer
- **modules/vytvoreni-arealu/index.html** (6.6 KB) - Facility designer
- **modules/ai-agenti/index.html** (41 KB) - AI assistant management
- **modules/admin-tasks/index.html** (15 KB) - Admin tasks
- **modules/audit-log/index.html** (14 KB) - Audit trail
- **modules/datovy-model/index.html** (1.8 KB) - Data model documentation

### AI Chat Panel
- **js/ai-chat-panel.js** (28 KB) - Embeddable chat widget
- **js/ai-assistant.js** (28 KB) - AI orchestrátor pro frontend

## Tech Stack

```
Vanilla JavaScript (ES6+)
↓
HTML5 + CSS3 (custom properties, grid, flexbox)
↓
Fetch API (for backend communication)
↓
LocalStorage (for offline state)
↓
Server-Sent Events (for streaming chat)
```

## CSS Architecture

### Global Styles (css/dashboard.css)

**CSS Variables** (téma):
```css
--bg: #f5f6f7              /* Background */
--surface: #ffffff         /* Cards, panels */
--text: #1a1a1a           /* Main text */
--text2: #666666          /* Secondary text */
--border: #e0e0e0         /* Borders */
--primary: #6c5ce7        /* HR (purple) */
--warehouse: #27ae60      /* Warehouse (green) */
--production: #e74c3c     /* Production (red) */
--sidebar-w: 260px        /* Sidebar width */
```

**Layout Components**:
- `.main-wrapper` - Main content area (flex, margin-left: sidebar-w)
- `.main-header` - Top section (gradient, padding, flex)
- `.main-content` - Content area (padding, flex: 1)
- `.tabs` - Tab navigation
- `.toolbar` - Button/filter bar
- `.table` - Data tables (sticky header, sortable)
- `.modal` - Modal dialogs (fixed overlay)
- `.sidebar` - Navigation sidebar (fixed left)

**Responsive**:
```css
@media (max-width: 768px) {
  .sidebar { transform: translateX(-100%); /* hidden */ }
  .main-wrapper { margin-left: 0; }
  .tabs { flex-wrap: wrap; }
}
```

## JavaScript Patterns

### Module Loading (sidebar.js)
```javascript
// Fetch module info from /api/ai/modules
// Dynamically render menu items
// On click: navigate to /modules/{slug}/
// Browser caches module HTML for offline access
```

### Data Fetching Pattern
```javascript
async function fetchData(endpoint) {
  try {
    const res = await fetch(endpoint, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (res.status === 401) redirectToLogin();
    return await res.json();
  } catch (err) {
    console.error(err);
    // Try localStorage fallback
    return JSON.parse(localStorage.getItem(endpoint) || '{}');
  }
}
```

### Form Handling Pattern
```javascript
const form = document.querySelector('form');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(form);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.fromEntries(formData))
  });
  if (res.ok) showSuccess('Uloženo');
  else showError('Chyba: ' + res.status);
});
```

### Streaming Chat Pattern (ai-chat-panel.js)
```javascript
const eventSource = new EventSource('/api/ai/chat/message?message=' + text);
eventSource.addEventListener('message', (event) => {
  const chunk = JSON.parse(event.data);
  if (chunk.type === 'text') displayText(chunk.content);
  if (chunk.type === 'skill_calls') displayTools(chunk.calls);
});
eventSource.addEventListener('error', () => eventSource.close());
```

## Module Structure

Each module has:
```
modules/{module-slug}/
├── index.html          # Main UI (includes CSS inline or via link)
├── app.js              # Module initialization + event listeners
├── state.js            # Local state management
├── api.js              # Backend API calls (fetch wrapper)
├── storage.js          # LocalStorage management
└── (optional) sub-modules (detail.js, editor.js, etc.)
```

### Example: modules/lide-hr/index.html
1. `<head>` - title, base href, CSS imports
2. `<body>` - sidebar + main wrapper
3. Inside main: header (gradient), tabs, toolbar (filters), content area
4. Content: data table + detail panel (flexbox split)
5. Inline `<script>` or external js/

## Common UI Components

### Data Table
```html
<table class="data-table">
  <thead>
    <tr><th>Jméno</th><th>Email</th><th>Akce</th></tr>
  </thead>
  <tbody id="table-body">
    <!-- Rows inserted via JS -->
  </tbody>
</table>
```

### Modal Dialog
```html
<div class="modal" id="edit-modal" style="display: none;">
  <div class="modal-content">
    <h2>Úprava</h2>
    <form id="edit-form"></form>
    <button onclick="closeModal()">Zrušit</button>
    <button onclick="submitForm()">Uložit</button>
  </div>
</div>
```

### Form Input
```html
<div class="form-group">
  <label for="name">Jméno:</label>
  <input type="text" id="name" name="name" placeholder="Zadej jméno">
</div>
```

### Loading Spinner
```html
<div class="spinner"></div>
<!-- CSS: @keyframes spin { 0% { transform: rotate(0deg); } } -->
```

## Pravidla

- **Bez frameworků**: Vanilla JS, no React/Vue
- **Čeština**: Všechny texty, placeholders, chyby
- **Responsive**: Mobile-first, @media queries
- **Accessibility**: Semantic HTML, aria labels, keyboard navigation
- **Performance**: Lazy-load moduly, cache API responses
- **Token storage**: Uložíme v sessionStorage (ne localStorage pro bezpečnost)
- **Error handling**: Try-catch, user feedback (toast messages)
- **Dark mode**: CSS proměnné usnadňují switch (dynamicky?)
- **Offline**: Fallback na localStorage když API není dostupné

## Nezasahuj do

- Backend routes (`routes/**`)
- Databáze (`prisma/schema.prisma`)
- MCP servers (`mcp-servers/**`)
- CI/CD (`scripts/`, `.github/`)

## Dodatečné poznatky

### Sidebar Struktura
```javascript
// sidebar.js fetchne /api/ai/modules
// Dynamicky renderuje {slug, title}
// Na click naviguje: window.location.href = '/modules/{slug}/'
// Aktuální modul je highlighted (dle window.location.pathname)
```

### Responsiveness
- Desktop: sidebar fixed left (260px), main content flex
- Tablet: sidebar collapses na drawer (off-screen)
- Mobile: sidebar hidden (hamburger menu)

### Offline Mode
- persistent-storage.js uloží responses v LS
- Při chybě API se vrátí data z LS (se stará UI)
- Badge "Offline" se zobrazí v header

### Dark Mode (budoucnost)
- CSS proměnné usnadňují: `--bg: #1a1a1a; --text: #f5f6f7;`
- localStorage preference: `theme: 'light' | 'dark'`
- `document.body.classList.add('dark-mode')`

### Charts & Data Viz
- Pro grafy: Lightweight library (Chart.js, D3.js, nebo vanilla SVG)
- Moduly si mohou najít svou vizualizaci (není centrální)

### Form Validation
- HTML5 validation (required, email, pattern)
- JS fallback: Zod na backendu, frontend zobrazuje chyby
- Real-time feedback: onChange validation (opcional)

### Authentication Flow
1. GET /public/login.html (bez tokenu)
2. POST /api/auth/login (username, password)
3. Response: {token, user}
4. Uložit token do sessionStorage
5. Redirect: window.location = '/'
6. index.html načte sidebar + modules

### Analytics (budoucnost)
- Trackovat pageviews přes /api/audit nebo localStorage
- Tracking: module_view, action_taken, duration
