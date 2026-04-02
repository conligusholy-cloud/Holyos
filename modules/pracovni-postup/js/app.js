/* ============================================
   app.js — Pracovní postup: Hlavní logika
   Seznam výrobků + vyhledávání
   ============================================ */

// DOM reference
const dom = {};

// ---- Inicializace ----
document.addEventListener('DOMContentLoaded', () => {
  dom.productList = document.getElementById('product-list');
  dom.searchInput = document.getElementById('search-input');
  dom.statusDot = document.getElementById('status-dot');
  dom.statusText = document.getElementById('status-text');
  dom.countBadge = document.getElementById('count-badge');

  // Vyhledávání
  dom.searchInput.addEventListener('input', () => {
    filterProducts(dom.searchInput.value);
  });

  // Automaticky načíst výrobky
  loadProducts();
});

// ---- Načíst výrobky ----
async function loadProducts() {
  showLoading();
  updateStatus('loading', 'Připojuji se k Factorify...');

  try {
    const products = await FactorifyAPI.loadProducts();
    updateStatus('connected', `Připojeno — ${products.length} výrobků`);
    dom.countBadge.textContent = products.length;
    renderProducts(products);
  } catch (err) {
    updateStatus('disconnected', 'Chyba připojení');
    showError(err.message);
  }
}

// ---- Render seznamu výrobků ----
function renderProducts(products) {
  if (!products || products.length === 0) {
    dom.productList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📦</div>
        <p>Žádné výrobky nenalezeny</p>
        <button class="btn" onclick="loadProducts()">Zkusit znovu</button>
      </div>`;
    return;
  }

  let html = '<div class="product-grid">';
  products.forEach(p => {
    const code = p.code ? escapeHtml(p.code) : '—';
    const name = escapeHtml(p.name);
    const type = escapeHtml(p.type || 'Výrobek');

    html += `
      <div class="product-card" onclick="openProduct(${p.id})" data-name="${name.toLowerCase()}" data-code="${code.toLowerCase()}">
        <div class="product-card-icon">🔧</div>
        <div class="product-card-info">
          <div class="product-card-name">${name}</div>
          <div class="product-card-meta">
            <span>${code}</span>
            <span>·</span>
            <span>${type}</span>
          </div>
        </div>
        <div class="product-card-arrow">→</div>
      </div>`;
  });
  html += '</div>';
  dom.productList.innerHTML = html;
}

// ---- Filtrování ----
function filterProducts(query) {
  const q = (query || '').toLowerCase().trim();
  const cards = document.querySelectorAll('.product-card');
  let visible = 0;

  cards.forEach(card => {
    const name = card.dataset.name || '';
    const code = card.dataset.code || '';
    const match = !q || name.includes(q) || code.includes(q);
    card.style.display = match ? '' : 'none';
    if (match) visible++;
  });

  dom.countBadge.textContent = q ? `${visible}/${FactorifyAPI.products.length}` : FactorifyAPI.products.length;
}

// ---- Otevřít detail výrobku ----
function openProduct(productId) {
  window.location.href = 'modules/pracovni-postup/detail.html?id=' + productId;
}

// ---- Stavy UI ----
function showLoading() {
  dom.productList.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Načítám výrobky z Factorify...</p>
    </div>`;
}

function showError(message) {
  dom.productList.innerHTML = `
    <div class="error-state">
      <div class="error-icon">⚠️</div>
      <div class="error-msg">${escapeHtml(message)}</div>
      <p style="font-size:12px; margin-bottom:16px;">Zkontrolujte, že běží proxy server (node proxy-server.js)</p>
      <button class="btn" onclick="loadProducts()">Zkusit znovu</button>
    </div>`;
}

function updateStatus(state, text) {
  dom.statusDot.className = 'status-dot ' + state;
  dom.statusText.textContent = text;
}

// ---- Helpers ----
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}
