/* ============================================
   factorify-api.js — Pracovní postup
   Přepojeno na vlastní HolyOS API (Fáze 3)
   ============================================ */
export const FactorifyAPI = {
    connected: false,
    loading: false,
    error: null,
    configLoaded: true,
    // Cache
    products: [],
    allItems: [],
    stages: [],
    async fetchAPI(path) {
        const resp = await fetch(path, { headers: { 'Accept': 'application/json' } });
        if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            throw new Error(`API ${resp.status}: ${errText.substring(0, 200)}`);
        }
        return await resp.json();
    },
    // ---- Načíst výrobky (z vlastní DB) ----
    async loadProducts() {
        this.loading = true;
        this.error = null;
        try {
            console.log('[PP] GET /api/production/products?type=product ...');
            const products = await this.fetchAPI('/api/production/products?type=product');
            console.log(`[PP] Načteno ${products.length} produktů`);
            this.allItems = products.map(p => ({
                id: p.id,
                name: p.name || ('Produkt ' + p.id),
                code: p.code || '',
                type: p.type || 'product',
            }));
            // Filtrovat výrobky (type === 'product', ne 'semi-product')
            this.products = this.allItems.filter(p => {
                const t = (p.type || '').toLowerCase().trim();
                return t === 'product' || t === 'výrobek' || t === 'vyrobek';
            });
            console.log(`[PP] Filtrováno: ${this.products.length} výrobků z ${this.allItems.length} celkem`);
            if (this.products.length === 0) {
                console.warn('[PP] Žádné výrobky — zobrazuji vše');
                this.products = this.allItems;
            }
            this.connected = true;
            this.loading = false;
            return this.products;
        }
        catch (err) {
            this.error = err.message;
            this.loading = false;
            throw err;
        }
    },
    // ---- Načíst pracoviště ----
    async loadStages() {
        try {
            const workstations = await this.fetchAPI('/api/production/workstations');
            this.stages = workstations.map(ws => ({
                id: ws.id,
                name: ws.name || ('Pracoviště ' + ws.id),
                code: ws.code || '',
            }));
            return this.stages;
        }
        catch (e) {
            console.error('[PP] loadStages error:', e);
            return [];
        }
    },
};
