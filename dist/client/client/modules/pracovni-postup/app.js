/* ============================================
   app.js — Pracovní postup: Hlavní logika
   Záložky Výrobky / Polotovary + vyhledávání
   ============================================ */
import { FactorifyAPI } from './factorify-api.js';
const dom = {
    productList: null,
    searchInput: null,
    statusDot: null,
    statusText: null,
    countBadge: null,
};
let allProducts = [];
let allSemiProducts = [];
let activeTab = 'product';
// ---- Inicializace ----
document.addEventListener('DOMContentLoaded', () => {
    dom.productList = document.getElementById('product-list');
    dom.searchInput = document.getElementById('search-input');
    dom.statusDot = document.getElementById('status-dot');
    dom.statusText = document.getElementById('status-text');
    dom.countBadge = document.getElementById('count-badge');
    if (dom.searchInput) {
        dom.searchInput.addEventListener('input', () => {
            filterProducts(dom.searchInput.value);
        });
    }
    loadProducts();
});
// ---- Načíst vše ----
export async function loadProducts() {
    showLoading();
    updateStatus('loading', 'Načítám data...');
    try {
        // Načíst obě kategorie paralelně
        const [products, semiProducts] = await Promise.all([
            fetchItems('product'),
            fetchItems('semi-product'),
        ]);
        allProducts = products;
        allSemiProducts = semiProducts;
        // Aktualizovat počty v záložkách
        const countProducts = document.getElementById('count-products');
        const countSemi = document.getElementById('count-semi');
        if (countProducts) countProducts.textContent = String(allProducts.length);
        if (countSemi) countSemi.textContent = String(allSemiProducts.length);
        const total = allProducts.length + allSemiProducts.length;
        updateStatus('connected', `Připojeno — ${total} položek`);
        // Zobrazit aktivní záložku
        renderActiveTab();
    }
    catch (err) {
        updateStatus('disconnected', 'Chyba připojení');
        showError(err.message);
    }
}
async function fetchItems(type) {
    const resp = await fetch(`/api/production/products?type=${type}`, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    return await resp.json();
}
// ---- Přepínání záložek ----
export function switchTab(tab) {
    activeTab = tab;
    // UI záložek
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    if (tab === 'product') {
        document.getElementById('tab-products')?.classList.add('active');
    } else {
        document.getElementById('tab-semi')?.classList.add('active');
    }
    // Reset vyhledávání
    if (dom.searchInput) dom.searchInput.value = '';
    renderActiveTab();
}
function renderActiveTab() {
    const items = activeTab === 'product' ? allProducts : allSemiProducts;
    const label = activeTab === 'product' ? 'výrobek' : 'polotovar';
    if (dom.countBadge) dom.countBadge.textContent = String(items.length);
    renderProducts(items, label);
}
// ---- Render seznamu ----
function renderProducts(products, typeLabel) {
    if (!dom.productList) return;
    if (!products || products.length === 0) {
        const label = typeLabel || 'položky';
        dom.productList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📦</div>
        <p>Žádné ${label} nenalezeny</p>
        <button class="btn" onclick="loadProducts()">Zkusit znovu</button>
      </div>`;
        return;
    }
    let html = '<div class="product-grid">';
    products.forEach(p => {
        const code = p.code ? escapeHtml(p.code) : '—';
        const name = escapeHtml(p.name);
        const type = escapeHtml(p.type || '');
        const icon = activeTab === 'product' ? '🔧' : '⚙️';
        html += `
      <div class="product-card" onclick="openProduct('${p.id}')" data-name="${name.toLowerCase()}" data-code="${code.toLowerCase()}">
        <div class="product-card-icon">${icon}</div>
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
export function filterProducts(query) {
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
    const total = activeTab === 'product' ? allProducts.length : allSemiProducts.length;
    if (dom.countBadge) {
        dom.countBadge.textContent = q ? `${visible}/${total}` : String(total);
    }
}
// ---- Otevřít detail ----
export function openProduct(productId) {
    window.location.href = 'modules/pracovni-postup/detail.html?id=' + productId;
}
// ---- UI stavy ----
function showLoading() {
    if (!dom.productList) return;
    dom.productList.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Načítám data...</p>
    </div>`;
}
function showError(message) {
    if (!dom.productList) return;
    dom.productList.innerHTML = `
    <div class="error-state">
      <div class="error-icon">⚠️</div>
      <div class="error-msg">${escapeHtml(message)}</div>
      <button class="btn" onclick="loadProducts()" style="margin-top:12px;">Zkusit znovu</button>
    </div>`;
}
function updateStatus(state, text) {
    if (dom.statusDot) dom.statusDot.className = 'status-dot ' + state;
    if (dom.statusText) dom.statusText.textContent = text;
}
// ---- Helpers ----
export function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
export function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}
// Expose global functions for onclick handlers
window.openProduct = openProduct;
window.loadProducts = loadProducts;
window.switchTab = switchTab;
