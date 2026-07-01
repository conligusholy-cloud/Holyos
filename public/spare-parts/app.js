// =============================================================================
// Spare Parts Shop — partner-facing SPA pro bestseries.cash/spare-parts
// Sdílí PartnerAccount login s Hugem (hugo_token cookie).
// =============================================================================

(function () {
  'use strict';

  const API = '/api/shop';

  const State = {
    me: null,           // /me odpověď (partner, company, has_access, currency, pricelist)
    view: 'loading',    // login | loading | catalog | product | cart | checkout | orders | order | profile
    products: [],
    selectedProduct: null,
    cart: [],           // [{material_id, code, name, unit, price_excl_vat, vat_pct, currency, photo_url, quantity}]
    categories: [],
    activeCategory: '',
    searchQ: '',
    shippingMethods: [],
    paymentMethods: [],
    checkout: {
      shipping_method_id: null,
      payment_method_id: null,
      ship_to_name: '',
      ship_to_company: '',
      ship_to_address: '',
      ship_to_city: '',
      ship_to_zip: '',
      ship_to_country: 'CZ',
      ship_to_email: '',
      ship_to_phone: '',
      customer_note: '',
    },
    orders: [],
    selectedOrder: null,
    toast: null,
  };

  // ─── Helpery ─────────────────────────────────────────────────────────────

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function fmt(n, currency) {
    if (n == null) return '—';
    return Number(n).toFixed(2) + ' ' + (currency || '');
  }

  function fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s);
    return d.toLocaleDateString('cs-CZ');
  }

  async function api(path, opts) {
    const res = await fetch(API + path, { credentials: 'same-origin', ...(opts || {}) });
    if (res.status === 401) { State.view = 'login'; render(); throw new Error('401'); }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_e) {}
    if (!res.ok) {
      const msg = (json && (json.error || json.message)) || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json;
  }

  function toast(msg, ms) {
    State.toast = msg;
    render();
    setTimeout(() => { if (State.toast === msg) { State.toast = null; render(); } }, ms || 2500);
  }

  // ─── Cart (localStorage) ─────────────────────────────────────────────────

  function cartKey() { return State.me && State.me.partner ? `shop_cart_${State.me.partner.id}` : 'shop_cart_anon'; }
  function loadCart() { try { State.cart = JSON.parse(localStorage.getItem(cartKey()) || '[]'); } catch (_e) { State.cart = []; } }
  function saveCart() { try { localStorage.setItem(cartKey(), JSON.stringify(State.cart)); } catch (_e) {} }
  function clearCart() { State.cart = []; saveCart(); }
  function cartCount() { return State.cart.reduce((a, it) => a + (it.quantity || 0), 0); }
  function cartLine(materialId) { return State.cart.find(it => it.material_id === materialId); }

  function addToCart(product, qty) {
    qty = Math.max(1, Math.floor(qty || 1));
    let line = cartLine(product.id);
    if (line) line.quantity += qty;
    else State.cart.push({
      material_id: product.id, code: product.code, name: product.name,
      unit: product.unit, price_excl_vat: product.price_excl_vat,
      vat_pct: product.vat_pct, currency: product.currency,
      photo_url: product.photo_url, quantity: qty,
    });
    saveCart();
    toast(`Přidáno ${qty}× ${product.name}`);
  }

  function updateCartQty(materialId, qty) {
    const line = cartLine(materialId);
    if (!line) return;
    qty = Math.floor(qty || 0);
    if (qty <= 0) State.cart = State.cart.filter(it => it.material_id !== materialId);
    else line.quantity = qty;
    saveCart();
    render();
  }

  function cartSubtotal() {
    return Math.round(State.cart.reduce((a, it) => a + it.price_excl_vat * it.quantity, 0) * 100) / 100;
  }

  // ─── Tracking helper ─────────────────────────────────────────────────────

  function trackingUrl(carrier, number) {
    if (!carrier || !number) return null;
    const c = String(carrier).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const n = encodeURIComponent(String(number).trim());
    if (/zasilkovna|packeta/.test(c)) return `https://tracking.packeta.com/cs_CZ/?id=${n}`;
    if (/dpd/.test(c)) return `https://tracking.dpd.cz/cs/parcels?query=${n}`;
    if (/gls/.test(c)) return `https://gls-group.eu/CZ/cs/sledovani-zasilek?match=${n}`;
    if (/ppl/.test(c)) return `https://www.ppl.cz/vyhledat-zasilku?shipmentId=${n}`;
    if (/cesk[aá] po[sš]ta|czech post|cposta/.test(c)) return `https://www.ceskaposta.cz/vnitrostatni-sluzby/dohledani-zasilky?searchPhrase=${n}`;
    return null; // neznámý dopravce — neukazujeme link, jen text
  }

  // ─── Bootstrap ──────────────────────────────────────────────────────────

  async function bootstrap() {
    try {
      State.me = await api('/me');
      loadCart();
      if (!State.me.has_access) {
        State.view = 'no-access';
        render();
      } else {
        State.view = 'catalog';
        loadCatalog(); // rovnou načti produkty, ať úvodní obrazovka není prázdná
      }
    } catch (err) {
      if (err.message === '401') return;
      State.view = 'error';
      State.error = err.message;
      render();
    }
  }

  // ─── Views ───────────────────────────────────────────────────────────────

  function topBar(title, subtitle) {
    return `
      <div class="shop-top">
        <div class="shop-logo">🛒</div>
        <div style="flex:1;">
          <div class="shop-name">${esc(title || 'Spare Parts Shop')}</div>
          ${subtitle ? `<div class="shop-tag">${esc(subtitle)}</div>` : ''}
        </div>
        <a href="/hugo" class="top-btn" title="Zpět do Huga">↩ Hugo</a>
        ${State.me ? `<button class="top-btn cart-badge" onclick="ShopApp.goCart()">🛒${cartCount() > 0 ? `<span class="count">${cartCount()}</span>` : ''}</button>` : ''}
      </div>`;
  }

  function bottomNav() {
    const items = [
      { id: 'catalog', icon: '🛒', label: 'Katalog' },
      { id: 'cart', icon: '🧺', label: 'Košík', badge: cartCount() },
      { id: 'orders', icon: '📦', label: 'Objednávky' },
      { id: 'profile', icon: '👤', label: 'Profil' },
    ];
    return `
      <nav class="bottom-nav">
        ${items.map(it => `
          <button class="nav-item ${State.view === it.id || (State.view === 'product' && it.id === 'catalog') || (State.view === 'checkout' && it.id === 'cart') || (State.view === 'order' && it.id === 'orders') ? 'active' : ''}" onclick="ShopApp.go('${it.id}')">
            <span class="icon">${it.icon}</span>
            <span>${esc(it.label)}${it.badge ? ` (${it.badge})` : ''}</span>
          </button>`).join('')}
      </nav>`;
  }

  function renderNoAccess() {
    return `
      ${topBar('Spare Parts Shop', State.me ? State.me.partner.display_name : '')}
      <div class="shop-content">
        <div class="empty">
          <div class="icon">🔒</div>
          <h3 style="margin:8px 0; color:var(--text);">Eshop pro vás zatím není nakonfigurován</h3>
          <p>Potřebujete přidělený ceník, abyste mohli nakupovat. Ozvěte se nám na <a href="mailto:servis@bestseries.cz">servis@bestseries.cz</a>.</p>
          <a href="/hugo" class="btn" style="margin-top:16px;">↩ Zpět do Huga</a>
        </div>
      </div>`;
  }

  function renderError() {
    return `
      ${topBar('Chyba')}
      <div class="shop-content">
        <div class="empty">
          <div class="icon">⚠️</div>
          <p class="error">${esc(State.error || 'Něco se pokazilo')}</p>
          <button class="btn" onclick="ShopApp.reload()">Zkusit znovu</button>
        </div>
      </div>`;
  }

  function renderLogin() {
    return `
      <div class="shop-app">
        <div class="login-card">
          <h1>🛒 Spare Parts Shop</h1>
          <p class="sub">Pro nakupování náhradních dílů se musíte přihlásit. Použijte stejné údaje jako v Hugovi.</p>
          <a href="/hugo" class="btn btn-primary btn-block">Přihlásit přes Huga</a>
        </div>
      </div>`;
  }

  async function loadCatalog() {
    try {
      const [products, categories] = await Promise.all([
        api(`/products?q=${encodeURIComponent(State.searchQ)}${State.activeCategory ? '&category_id=' + State.activeCategory : ''}`),
        api('/categories'),
      ]);
      State.products = products;
      State.categories = categories;
      render();
    } catch (err) {
      State.error = err.message; State.view = 'error'; render();
    }
  }

  function renderCategoryChips() {
    // Filtrujeme jen kategorie, které mají alespoň jeden eshop-produkt (z _count.materials).
    // "Vše" chip resetuje filter; activeCategory='' znamená vše.
    const cats = (State.categories || []).filter(c => !c._count || c._count.materials > 0);
    if (!cats.length && !State.activeCategory) return '';
    const allActive = !State.activeCategory ? 'active' : '';
    let html = `<div class="cat-chips"><button class="cat-chip ${allActive}" onclick="ShopApp.onCategory('')">Vše</button>`;
    cats.forEach(c => {
      const active = String(State.activeCategory) === String(c.id) ? 'active' : '';
      const cnt = c._count ? c._count.materials : 0;
      html += `<button class="cat-chip ${active}" onclick="ShopApp.onCategory(${c.id})">${esc(c.icon || '')} ${esc(c.name)}${cnt ? ` <span class="cnt">${cnt}</span>` : ''}</button>`;
    });
    html += '</div>';
    return html;
  }

  function renderCatalog() {
    const grid = State.products.length ? `
      <div class="product-grid">
        ${State.products.map(p => `
          <div class="product-card" onclick="ShopApp.openProduct(${p.id})">
            <div class="product-photo">${p.photo_url ? `<img src="${esc(p.photo_url)}" alt="">` : '📦'}</div>
            <div class="product-code">${esc(p.code)}</div>
            <div class="product-name">${esc(p.name)}</div>
            <div class="product-price">${esc(fmt(p.price_incl_vat, p.currency))}</div>
            <div class="product-stock">${p.available_qty > 0 ? `Skladem ${p.available_qty} ${esc(p.unit || '')}` : (p.backorder ? '<span style="color:var(--accent);">Na objednávku</span>' : 'Vyprodáno')}</div>
          </div>`).join('')}
      </div>
    ` : `<div class="empty"><div class="icon">📭</div>${State.searchQ || State.activeCategory ? 'Nic neodpovídá filtru.' : 'Zatím žádné produkty.'}</div>`;
    return `
      ${topBar('Náhradní díly', State.me && State.me.company ? State.me.company.name : '')}
      <div class="shop-content">
        <div class="filters-row">
          <input type="search" placeholder="🔍 Hledat kód/název" value="${esc(State.searchQ)}" oninput="ShopApp.onSearch(this.value)">
        </div>
        ${renderCategoryChips()}
        ${grid}
      </div>
      ${bottomNav()}`;
  }

  async function openProduct(id) {
    State.view = 'loading'; render();
    try {
      State.selectedProduct = await api(`/products/${id}`);
      State.view = 'product';
      State.productQty = 1;
      render();
    } catch (err) { State.error = err.message; State.view = 'error'; render(); }
  }

  function renderProduct() {
    const p = State.selectedProduct;
    if (!p) return renderCatalog();
    return `
      ${topBar('Detail produktu', '')}
      <div class="shop-content product-detail">
        <button class="btn" onclick="ShopApp.go('catalog')" style="margin-bottom:12px;">← Zpět</button>
        <div class="photo">${p.photo_url ? `<img src="${esc(p.photo_url)}" alt="">` : '📦'}</div>
        <div style="font-size:12px; color:var(--text2); font-family:monospace;">${esc(p.code)}</div>
        <h1>${esc(p.name)}</h1>
        ${(p.categories && p.categories.length) ? `<div style="color:var(--text2); font-size:13px;">${p.categories.map(c => esc(c.name)).join(', ')}</div>` : (p.category ? `<div style="color:var(--text2); font-size:13px;">${esc(p.category.name)}</div>` : '')}
        ${p.description ? `<div class="desc">${esc(p.description)}</div>` : ''}
        <div style="margin:16px 0;">
          <div style="font-size:24px; font-weight:700; color:var(--accent);">${esc(fmt(p.price_incl_vat, p.currency))} <span style="font-size:13px; color:var(--text2); font-weight:normal;">s DPH</span></div>
          <div style="font-size:13px; color:var(--text2);">${esc(fmt(p.price_excl_vat, p.currency))} bez DPH</div>
          <div style="font-size:12px; color:var(--text2); margin-top:4px;">${p.available_qty > 0 ? `Skladem ${p.available_qty} ${esc(p.unit || '')}` : (p.backorder ? '<span style="color:var(--accent);">Na objednávku — dodáme po naskladnění</span>' : 'Vyprodáno')}</div>
        </div>
        <div class="qty-row">
          <button onclick="ShopApp.qtyAdjust(-1)">−</button>
          <input type="number" id="prod-qty" value="${State.productQty || 1}" min="1"${p.backorder && p.available_qty <= 0 ? '' : ` max="${p.available_qty}"`} onchange="ShopApp.qtySet(this.value)">
          <button onclick="ShopApp.qtyAdjust(1)">+</button>
          <span style="color:var(--text2);">${esc(p.unit || '')}</span>
        </div>
        <button class="btn btn-primary btn-block" onclick="ShopApp.addCurrentToCart()">🧺 Přidat do košíku</button>
      </div>
      ${bottomNav()}`;
  }

  function renderCart() {
    if (State.cart.length === 0) {
      return `
        ${topBar('Košík')}
        <div class="shop-content">
          <div class="empty">
            <div class="icon">🛒</div>
            <p>Košík je prázdný.</p>
            <button class="btn btn-primary" onclick="ShopApp.go('catalog')">Pokračovat v nákupu</button>
          </div>
        </div>
        ${bottomNav()}`;
    }
    const subtotal = cartSubtotal();
    const currency = State.cart[0] ? State.cart[0].currency : (State.me && State.me.currency) || 'EUR';
    const vat = State.cart[0] ? State.cart[0].vat_pct : 21;
    return `
      ${topBar('Košík')}
      <div class="shop-content">
        ${State.cart.map(it => `
          <div class="cart-item">
            <div class="photo">${it.photo_url ? `<img src="${esc(it.photo_url)}" alt="">` : '📦'}</div>
            <div class="info">
              <div class="name">${esc(it.name)}</div>
              <div class="code">${esc(it.code)}</div>
              <div class="price">${esc(fmt(it.price_excl_vat * it.quantity, it.currency))} bez DPH</div>
            </div>
            <div class="actions">
              <div class="qty">
                <button class="top-btn" onclick="ShopApp.cartQty(${it.material_id}, ${it.quantity - 1})">−</button>
                <input type="number" value="${it.quantity}" min="1" onchange="ShopApp.cartQty(${it.material_id}, parseInt(this.value, 10))">
                <button class="top-btn" onclick="ShopApp.cartQty(${it.material_id}, ${it.quantity + 1})">+</button>
              </div>
              <button class="top-btn" onclick="ShopApp.cartQty(${it.material_id}, 0)" style="color:var(--danger);">Odebrat</button>
            </div>
          </div>`).join('')}
        <div class="cart-summary">
          <div class="summary-row"><span>Mezisoučet bez DPH</span><span>${esc(fmt(subtotal, currency))}</span></div>
          <div class="summary-row"><span>DPH (${vat} %)</span><span>${esc(fmt(subtotal * vat / 100, currency))}</span></div>
          <div class="summary-row total"><span>Celkem s DPH</span><span>${esc(fmt(subtotal * (1 + vat / 100), currency))}</span></div>
          <div style="font-size:11px; color:var(--text2); margin-top:6px;">Doprava a platba se přičtou na pokladně.</div>
        </div>
        <button class="btn btn-primary btn-block" style="margin-top:16px;" onclick="ShopApp.goCheckout()">Pokladna →</button>
      </div>
      ${bottomNav()}`;
  }

  async function goCheckout() {
    State.view = 'loading'; render();
    try {
      const [ship, pay] = await Promise.all([api('/shipping-methods'), api('/payment-methods')]);
      State.shippingMethods = ship;
      State.paymentMethods = pay;

      // Předvyplnění z poslední ne-cancelled objednávky (perzistence napříč
      // checkouty) — jen pokud pole jsou prázdná. Fail-tolerant: chyba načtení
      // neblokuje checkout, jen předvyplnění z firmy/profilu zafunguje místo toho.
      let lastOrder = null;
      try {
        const orders = await api('/orders');
        lastOrder = (orders || []).find(o => o.status !== 'cancelled');
        // GET /orders vrací list bez ship_to_*, musíme detail
        if (lastOrder) {
          lastOrder = await api(`/orders/${lastOrder.id}`);
        }
      } catch (_e) { /* ignore */ }

      const c = State.checkout;
      if (lastOrder) {
        c.ship_to_name    = c.ship_to_name    || lastOrder.ship_to_name    || '';
        c.ship_to_company = c.ship_to_company || lastOrder.ship_to_company || '';
        c.ship_to_address = c.ship_to_address || lastOrder.ship_to_address || '';
        c.ship_to_city    = c.ship_to_city    || lastOrder.ship_to_city    || '';
        c.ship_to_zip     = c.ship_to_zip     || lastOrder.ship_to_zip     || '';
        c.ship_to_country = c.ship_to_country || lastOrder.ship_to_country || 'CZ';
        c.ship_to_email   = c.ship_to_email   || lastOrder.ship_to_email   || '';
        c.ship_to_phone   = c.ship_to_phone   || lastOrder.ship_to_phone   || '';
        c.shipping_method_id = c.shipping_method_id || (lastOrder.shipping_method && lastOrder.shipping_method.id) || null;
        c.payment_method_id  = c.payment_method_id  || (lastOrder.payment_method  && lastOrder.payment_method.id)  || null;
      }

      // Fallback: pokud pořád prázdné, vezmi z firmy/profilu
      if (State.me && State.me.company) {
        c.ship_to_company = c.ship_to_company || State.me.company.name;
      }
      if (State.me && State.me.partner) {
        c.ship_to_name  = c.ship_to_name  || State.me.partner.display_name;
        c.ship_to_email = c.ship_to_email || State.me.partner.email || '';
      }
      if (!c.shipping_method_id && ship.length) c.shipping_method_id = ship[0].id;
      if (!c.payment_method_id && pay.length) c.payment_method_id = pay[0].id;

      State.view = 'checkout';
      render();
    } catch (err) { State.error = err.message; State.view = 'error'; render(); }
  }

  function renderCheckout() {
    const c = State.checkout;
    const subtotal = cartSubtotal();
    const ship = State.shippingMethods.find(s => s.id === c.shipping_method_id);
    const pay = State.paymentMethods.find(p => p.id === c.payment_method_id);
    const currency = State.cart[0] ? State.cart[0].currency : (State.me && State.me.currency) || 'EUR';
    const vat = State.cart[0] ? State.cart[0].vat_pct : 21;
    const shipExcl = ship ? ((ship.free_above_amount != null && subtotal >= Number(ship.free_above_amount)) ? 0 : Number(ship.price_excl_vat)) : 0;
    const payFee = pay ? Number(pay.fee_excl_vat) : 0;
    const totalExcl = Math.round((subtotal + shipExcl + payFee) * 100) / 100;
    const totalIncl = Math.round(totalExcl * (1 + vat / 100) * 100) / 100;
    return `
      ${topBar('Pokladna')}
      <div class="shop-content">
        <button class="btn" onclick="ShopApp.go('cart')" style="margin-bottom:12px;">← Zpět do košíku</button>

        <h3 style="font-size:14px; margin:16px 0 8px;">Doprava</h3>
        <div class="radio-list">
          ${State.shippingMethods.map(s => `
            <label class="radio-card">
              <input type="radio" name="ship" value="${s.id}" ${c.shipping_method_id === s.id ? 'checked' : ''} onchange="ShopApp.setShip(${s.id})">
              <div style="flex:1;">
                <div class="label">${esc(s.name)}</div>
                ${s.description ? `<div class="desc">${esc(s.description)}</div>` : ''}
                ${s.free_above_amount != null ? `<div class="desc">Zdarma od ${esc(fmt(s.free_above_amount, s.currency))}</div>` : ''}
              </div>
              <div class="price">${(s.free_above_amount != null && subtotal >= Number(s.free_above_amount)) ? 'Zdarma' : esc(fmt(s.price_excl_vat, s.currency))}</div>
            </label>`).join('')}
        </div>

        <h3 style="font-size:14px; margin:16px 0 8px;">Platba</h3>
        <div class="radio-list">
          ${State.paymentMethods.map(p => `
            <label class="radio-card">
              <input type="radio" name="pay" value="${p.id}" ${c.payment_method_id === p.id ? 'checked' : ''} onchange="ShopApp.setPay(${p.id})">
              <div style="flex:1;">
                <div class="label">${esc(p.name)}</div>
                ${p.description ? `<div class="desc">${esc(p.description)}</div>` : ''}
              </div>
              <div class="price">${Number(p.fee_excl_vat) > 0 ? '+ ' + esc(fmt(p.fee_excl_vat, currency)) : '—'}</div>
            </label>`).join('')}
        </div>

        <h3 style="font-size:14px; margin:16px 0 8px;">Adresa dodání</h3>
        <div class="form-group"><label>Jméno *</label><input type="text" value="${esc(c.ship_to_name)}" oninput="ShopApp.setField('ship_to_name', this.value)"></div>
        <div class="form-group"><label>Firma</label><input type="text" value="${esc(c.ship_to_company)}" oninput="ShopApp.setField('ship_to_company', this.value)"></div>
        <div class="form-group"><label>Ulice a č.p. *</label><input type="text" value="${esc(c.ship_to_address)}" oninput="ShopApp.setField('ship_to_address', this.value)"></div>
        <div style="display:flex; gap:8px;">
          <div class="form-group" style="flex:1;"><label>PSČ *</label><input type="text" value="${esc(c.ship_to_zip)}" oninput="ShopApp.setField('ship_to_zip', this.value)"></div>
          <div class="form-group" style="flex:2;"><label>Město *</label><input type="text" value="${esc(c.ship_to_city)}" oninput="ShopApp.setField('ship_to_city', this.value)"></div>
          <div class="form-group" style="width:80px;"><label>Země</label><input type="text" maxlength="2" value="${esc(c.ship_to_country)}" oninput="ShopApp.setField('ship_to_country', this.value.toUpperCase())"></div>
        </div>
        <div class="form-group"><label>E-mail *</label><input type="email" value="${esc(c.ship_to_email)}" oninput="ShopApp.setField('ship_to_email', this.value)"></div>
        <div class="form-group"><label>Telefon *</label><input type="tel" value="${esc(c.ship_to_phone)}" oninput="ShopApp.setField('ship_to_phone', this.value)"></div>
        <div class="form-group"><label>Poznámka (volitelně)</label><textarea rows="2" oninput="ShopApp.setField('customer_note', this.value)">${esc(c.customer_note)}</textarea></div>

        <div class="cart-summary">
          <div class="summary-row"><span>Mezisoučet</span><span>${esc(fmt(subtotal, currency))}</span></div>
          <div class="summary-row"><span>Doprava</span><span>${esc(fmt(shipExcl, currency))}</span></div>
          ${payFee > 0 ? `<div class="summary-row"><span>Poplatek za platbu</span><span>${esc(fmt(payFee, currency))}</span></div>` : ''}
          <div class="summary-row"><span>DPH (${vat} %)</span><span>${esc(fmt(totalIncl - totalExcl, currency))}</span></div>
          <div class="summary-row total"><span>Celkem s DPH</span><span>${esc(fmt(totalIncl, currency))}</span></div>
        </div>

        <button class="btn btn-primary btn-block" style="margin-top:16px;" onclick="ShopApp.submitOrder()">Závazně objednat</button>
        <div style="font-size:11px; color:var(--text2); margin-top:8px; text-align:center;">Kliknutím potvrzuji objednávku. Rezervace skladu platí 72 hodin.</div>
      </div>
      ${bottomNav()}`;
  }

  async function submitOrder() {
    const c = State.checkout;
    if (!c.shipping_method_id || !c.payment_method_id) { toast('Vyber dopravu a platbu'); return; }
    if (!c.ship_to_name || !c.ship_to_address || !c.ship_to_city || !c.ship_to_zip) { toast('Vyplň povinné údaje adresy'); return; }
    if (!c.ship_to_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.ship_to_email)) { toast('Zadej platný e-mail'); return; }
    if (!c.ship_to_phone || c.ship_to_phone.trim().length < 6) { toast('Zadej telefonní číslo'); return; }
    const body = {
      items: State.cart.map(it => ({ material_id: it.material_id, quantity: it.quantity })),
      shipping_method_id: c.shipping_method_id,
      payment_method_id: c.payment_method_id,
      ship_to_name: c.ship_to_name,
      ship_to_company: c.ship_to_company || null,
      ship_to_address: c.ship_to_address,
      ship_to_city: c.ship_to_city,
      ship_to_zip: c.ship_to_zip,
      ship_to_country: c.ship_to_country || 'CZ',
      ship_to_email: c.ship_to_email || null,
      ship_to_phone: c.ship_to_phone || null,
      customer_note: c.customer_note || null,
    };
    State.view = 'loading'; render();
    try {
      const order = await api('/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      clearCart();
      State.selectedOrder = order;
      State.view = 'order-thanks';
      render();
    } catch (err) {
      State.error = err.message;
      State.view = 'error';
      render();
    }
  }

  function renderOrderThanks() {
    const o = State.selectedOrder;
    return `
      ${topBar('Objednávka přijata')}
      <div class="shop-content">
        <div class="empty">
          <div class="icon">✅</div>
          <h2 style="color:var(--success);">Objednávka přijata!</h2>
          <p>Číslo: <strong style="font-family:monospace;">${esc(o.order_number)}</strong></p>
          <p>Pošleme vám potvrzení e-mailem a do 72 hodin objednávku zpracujeme.</p>
          <button class="btn" onclick="ShopApp.go('orders')">Moje objednávky</button>
          <button class="btn btn-primary" onclick="ShopApp.go('catalog')" style="margin-left:8px;">Pokračovat v nákupu</button>
        </div>
      </div>
      ${bottomNav()}`;
  }

  async function loadOrders() {
    try {
      State.orders = await api('/orders');
      render();
    } catch (err) { State.error = err.message; State.view = 'error'; render(); }
  }

  function renderOrders() {
    if (!State.orders.length) {
      return `
        ${topBar('Moje objednávky')}
        <div class="shop-content">
          <div class="empty"><div class="icon">📦</div>Zatím žádná objednávka</div>
        </div>
        ${bottomNav()}`;
    }
    return `
      ${topBar('Moje objednávky')}
      <div class="shop-content">
        ${State.orders.map(o => `
          <div class="order-row" onclick="ShopApp.openOrder(${o.id})">
            <div>
              <div class="num">${esc(o.order_number)}</div>
              <div class="date">${esc(fmtDate(o.created_at))} • ${o._count ? o._count.items : 0} pol.</div>
            </div>
            <div style="text-align:right;">
              <span class="status-badge status-${esc(o.status)}">${esc(o.status)}</span>
              <div class="total">${esc(fmt(o.total_incl_vat, o.currency))}</div>
            </div>
          </div>`).join('')}
      </div>
      ${bottomNav()}`;
  }

  async function openOrder(id) {
    State.view = 'loading'; render();
    try {
      State.selectedOrder = await api(`/orders/${id}`);
      State.view = 'order';
      render();
    } catch (err) { State.error = err.message; State.view = 'error'; render(); }
  }

  function renderOrderDetail() {
    const o = State.selectedOrder;
    if (!o) return renderOrders();
    return `
      ${topBar(`Objednávka ${o.order_number}`)}
      <div class="shop-content">
        <button class="btn" onclick="ShopApp.go('orders')" style="margin-bottom:12px;">← Zpět</button>
        <div style="margin-bottom:12px;">
          <span class="status-badge status-${esc(o.status)}">${esc(o.status)}</span>
          <span style="color:var(--text2); font-size:12px; margin-left:8px;">${esc(fmtDate(o.created_at))}</span>
        </div>
        ${o.tracking_number ? (() => {
          const url = trackingUrl(o.tracking_carrier, o.tracking_number);
          const txt = `${esc(o.tracking_carrier || 'Dopravce')} — ${esc(o.tracking_number)}`;
          return `<div class="cart-summary" style="margin-bottom:12px;">
            <div style="font-size:11px; color:var(--text2); text-transform:uppercase; margin-bottom:4px;">📦 Sledování zásilky</div>
            ${url ? `<a href="${url}" target="_blank" rel="noopener" style="color:var(--accent); font-weight:600; text-decoration:none;">${txt} ↗</a>` : `<span style="font-weight:600;">${txt}</span>`}
          </div>`;
        })() : ''}
        ${o.items.map(it => `
          <div class="cart-item">
            <div class="photo">📦</div>
            <div class="info">
              <div class="name">${esc(it.material_name)}</div>
              <div class="code">${esc(it.material_code)}</div>
              <div class="price">${Number(it.quantity)} ${esc(it.unit)} × ${esc(fmt(it.unit_price_excl, o.currency))}</div>
            </div>
            <div class="actions">
              <div style="font-weight:700; color:var(--accent);">${esc(fmt(it.total_excl, o.currency))}</div>
            </div>
          </div>`).join('')}
        <div class="cart-summary">
          <div class="summary-row"><span>Doprava (${esc(o.shipping_method.name)})</span><span>${esc(fmt(o.shipping_excl, o.currency))}</span></div>
          ${Number(o.payment_fee_excl) > 0 ? `<div class="summary-row"><span>Platba (${esc(o.payment_method.name)})</span><span>${esc(fmt(o.payment_fee_excl, o.currency))}</span></div>` : `<div class="summary-row"><span>Platba</span><span>${esc(o.payment_method.name)}</span></div>`}
          <div class="summary-row"><span>Bez DPH</span><span>${esc(fmt(o.total_excl, o.currency))}</span></div>
          <div class="summary-row total"><span>Celkem s DPH</span><span>${esc(fmt(o.total_incl_vat, o.currency))}</span></div>
        </div>
        <div style="margin-top:12px; padding:12px; background:var(--surface); border-radius:10px; border:1px solid var(--border);">
          <div style="font-size:11px; color:var(--text2); text-transform:uppercase; margin-bottom:4px;">Adresa dodání</div>
          ${esc(o.ship_to_name)}<br>
          ${o.ship_to_company ? esc(o.ship_to_company) + '<br>' : ''}
          ${esc(o.ship_to_address)}<br>
          ${esc(o.ship_to_zip)} ${esc(o.ship_to_city)}, ${esc(o.ship_to_country)}
        </div>
        ${o.status === 'new' ? `
          <div style="margin-top:16px; padding:12px; background:rgba(239,68,68,0.05); border:1px solid rgba(239,68,68,0.2); border-radius:10px;">
            <div style="font-size:12px; color:var(--text2); margin-bottom:8px;">Objednávka zatím není potvrzená — můžete ji do 72 hodin sami stornovat.</div>
            <button class="btn" style="background:var(--danger); color:#fff; border-color:var(--danger);" onclick="ShopApp.cancelOrder(${o.id})">Zrušit objednávku</button>
          </div>
        ` : ''}
        ${(o.status === 'delivered' || o.status === 'closed' || o.status === 'shipped') ? `
          <div style="margin-top:16px; padding:12px; background:rgba(34,197,94,0.05); border:1px solid rgba(34,197,94,0.2); border-radius:10px;">
            <div style="font-size:12px; color:var(--text2); margin-bottom:8px;">Potřebujete to znovu? Přidáme stejné položky do košíku za aktuální ceny.</div>
            <button class="btn btn-primary" onclick="ShopApp.reorder(${o.id})">🔄 Objednat znovu</button>
          </div>
        ` : ''}
      </div>
      ${bottomNav()}`;
  }

  async function reorderOrder(orderId) {
    State.view = 'loading'; render();
    try {
      const o = State.selectedOrder && State.selectedOrder.id === orderId
        ? State.selectedOrder
        : await api(`/orders/${orderId}`);
      let added = 0, skipped = 0;
      for (const it of o.items) {
        if (it.material_id == null) { skipped++; continue; }
        try {
          const product = await api(`/products/${it.material_id}`);
          if (product.available_qty > 0) {
            const qty = Math.min(Number(it.quantity), product.available_qty);
            addToCart(product, qty);
            added++;
          } else {
            skipped++;
          }
        } catch (_e) {
          skipped++; // produkt už není v katalogu
        }
      }
      State.view = 'cart';
      render();
      toast(skipped > 0
        ? `Přidáno ${added} položek do košíku, ${skipped} už není dostupných.`
        : `Přidáno ${added} položek do košíku.`,
        4000);
    } catch (err) {
      State.error = err.message; State.view = 'error'; render();
    }
  }

  async function cancelOrder(id) {
    if (!confirm('Opravdu chcete tuto objednávku zrušit? Tato akce je nevratná.')) return;
    State.view = 'loading'; render();
    try {
      await api(`/orders/${id}/cancel`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ reason: 'cancelled_by_partner' }) });
      toast('Objednávka byla zrušena.');
      // Reload list
      State.orders = await api('/orders');
      State.view = 'orders';
      render();
    } catch (err) {
      State.error = err.message; State.view = 'error'; render();
    }
  }

  function renderProfile() {
    const me = State.me;
    return `
      ${topBar('Profil')}
      <div class="shop-content">
        <div class="cart-summary">
          <div style="font-size:11px; color:var(--text2); text-transform:uppercase;">Partner</div>
          <h2 style="margin:4px 0 12px;">${esc(me.partner.display_name)}</h2>
          <div class="summary-row"><span>Uživatelské jméno</span><span>${esc(me.partner.username)}</span></div>
          ${me.partner.email ? `<div class="summary-row"><span>E-mail</span><span>${esc(me.partner.email)}</span></div>` : ''}
          ${me.company ? `<div class="summary-row"><span>Firma</span><span>${esc(me.company.name)}</span></div>` : ''}
          ${me.pricelist ? `<div class="summary-row"><span>Ceník</span><span>${esc(me.pricelist.name)} (${esc(me.pricelist.currency)}, DPH ${me.pricelist.vat_pct} %)</span></div>` : ''}
        </div>
        <a href="/hugo" class="btn btn-block" style="margin-top:16px;">↩ Zpět do Huga</a>
      </div>
      ${bottomNav()}`;
  }

  function renderLoading() {
    return `<div class="empty"><div class="icon">⏳</div>Načítám…</div>`;
  }

  // ─── Master render ───────────────────────────────────────────────────────

  function render() {
    const app = document.getElementById('app');
    let html = '';
    if (State.view === 'login') html = renderLogin();
    else if (State.view === 'loading') html = renderLoading();
    else if (State.view === 'no-access') html = renderNoAccess();
    else if (State.view === 'error') html = renderError();
    else if (State.view === 'catalog') html = renderCatalog();
    else if (State.view === 'product') html = renderProduct();
    else if (State.view === 'cart') html = renderCart();
    else if (State.view === 'checkout') html = renderCheckout();
    else if (State.view === 'order-thanks') html = renderOrderThanks();
    else if (State.view === 'orders') html = renderOrders();
    else if (State.view === 'order') html = renderOrderDetail();
    else if (State.view === 'profile') html = renderProfile();
    else html = renderCatalog();
    if (State.toast) html += `<div class="toast">${esc(State.toast)}</div>`;
    app.innerHTML = html;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  window.ShopApp = {
    reload: bootstrap,
    go: function (view) {
      if (view === 'catalog') { State.view = 'catalog'; if (!State.products.length) loadCatalog(); else render(); }
      else if (view === 'cart') { State.view = 'cart'; render(); }
      else if (view === 'orders') { State.view = 'orders'; loadOrders(); }
      else if (view === 'profile') { State.view = 'profile'; render(); }
    },
    goCart: function () { State.view = 'cart'; render(); },
    goCheckout: goCheckout,
    onSearch: function (v) { State.searchQ = v; clearTimeout(window._ssT); window._ssT = setTimeout(loadCatalog, 350); },
    onCategory: function (v) { State.activeCategory = v; loadCatalog(); },
    openProduct: openProduct,
    qtyAdjust: function (d) {
      const p = State.selectedProduct;
      const max = (p && p.backorder) ? 9999 : ((p && p.available_qty) || 999);
      State.productQty = Math.max(1, Math.min(max, (State.productQty || 1) + d));
      document.getElementById('prod-qty').value = State.productQty;
    },
    qtySet: function (v) {
      const p = State.selectedProduct;
      const max = (p && p.backorder) ? 9999 : ((p && p.available_qty) || 999);
      State.productQty = Math.max(1, Math.min(max, parseInt(v, 10) || 1));
    },
    addCurrentToCart: function () {
      if (!State.selectedProduct) return;
      addToCart(State.selectedProduct, State.productQty || 1);
      State.view = 'catalog'; render();
    },
    cartQty: updateCartQty,
    setShip: function (id) { State.checkout.shipping_method_id = id; render(); },
    setPay: function (id) { State.checkout.payment_method_id = id; render(); },
    setField: function (key, value) { State.checkout[key] = value; },
    submitOrder: submitOrder,
    openOrder: openOrder,
    cancelOrder: cancelOrder,
    reorder: reorderOrder,
  };

  bootstrap();
})();
