/* ============================================
   factorify-api.js — Pracovní postup
   Načtení zboží (Item) s typem "výrobek"
   ============================================ */

const ENV_PATHS = [
  '../../.env',
  '../../../.env',
  './.env',
];

const FactorifyAPI = {

  connected: false,
  loading: false,
  error: null,
  configLoaded: false,

  config: {
    baseUrl: 'https://bs.factorify.cloud',
    proxyUrl: 'http://localhost:3001',
    useProxy: true,
    securityToken: '',
    headers: {
      'Accept': 'application/json',
      'X-FySerialization': 'ui2',
    },
  },

  // Cache
  products: [],       // zboží typu výrobek
  allItems: [],       // vše z entity Item
  stages: [],         // pracoviště

  parseEnv(text) {
    const result = {};
    text.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const eq = line.indexOf('=');
      if (eq < 0) return;
      let key = line.substring(0, eq).trim();
      let val = line.substring(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    });
    return result;
  },

  async loadEnv() {
    for (const path of ENV_PATHS) {
      try {
        const resp = await fetch(path, { cache: 'no-store' });
        if (resp.ok) {
          const text = await resp.text();
          const env = this.parseEnv(text);
          if (env.FACTORIFY_BASE_URL) this.config.baseUrl = env.FACTORIFY_BASE_URL;
          if (env.FACTORIFY_TOKEN) this.config.securityToken = env.FACTORIFY_TOKEN;
          this.configLoaded = true;
          console.log('[PP] .env načten z:', path);
          return true;
        }
      } catch (e) {}
    }
    return false;
  },

  async fetchAPI(path, options = {}) {
    const cfg = this.config;
    const method = options.method || 'GET';
    const body = options.body || null;

    if (cfg.useProxy) {
      const url = cfg.proxyUrl + path;
      const fetchOpts = {
        method,
        headers: { 'Accept': 'application/json', 'X-FySerialization': 'ui2' },
      };
      if (body) {
        fetchOpts.headers['Content-Type'] = 'application/json';
        fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
      const resp = await fetch(url, fetchOpts);
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`API ${resp.status}: ${errText.substring(0, 200)}`);
      }
      return await resp.json();
    }

    throw new Error('Spusťte proxy server (node proxy-server.js)');
  },

  async queryEntity(entityName, filter) {
    return await this.fetchAPI('/api/query/' + entityName, {
      method: 'POST',
      body: filter || {},
    });
  },

  extractArray(data) {
    if (Array.isArray(data)) return data;
    if (data && data.rows) return data.rows;
    if (data && data.items) return data.items;
    if (data && data.records) return data.records;
    if (data && data.data) return data.data;
    if (data && typeof data === 'object') {
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key])) return data[key];
      }
    }
    return [];
  },

  // ---- Načíst zboží (Goods) ----
  async loadProducts() {
    this.loading = true;
    this.error = null;

    try {
      if (!this.configLoaded) await this.loadEnv();

      // Factorify entita pro zboží = Goods
      console.log('[PP] POST /api/query/Goods ...');
      const data = await this.queryEntity('Goods');

      // Data jsou v data.rows
      const items = data.rows || this.extractArray(data);
      console.log(`[PP] Načteno ${items.length} položek z entity Goods`);

      // Mapovat na naše objekty
      this.allItems = items.map(item => {
        const rawType = item.type || '';
        let typeName = '';
        if (typeof rawType === 'object' && rawType !== null) {
          typeName = rawType.name || rawType.label || rawType.referenceName || String(rawType.id || '');
        } else {
          typeName = String(rawType);
        }

        return {
          id: item.id,
          name: item.name || ('Položka ' + (item.id || '')),
          code: item.code || '',
          type: typeName,
          workflowId: item.workflow ? item.workflow.id : null,
          raw: item,
        };
      });

      // Filtrovat pouze výrobky (type.name obsahuje "Výrobek")
      this.products = this.allItems.filter(p => {
        const t = (p.type || '').toLowerCase();
        return t.includes('výrobek') || t.includes('vyrobek');
      });

      console.log(`[PP] Filtrováno: ${this.products.length} výrobků z ${this.allItems.length} celkem`);

      // Pokud filtr nenašel nic — ukázat vše
      if (this.products.length === 0) {
        console.warn('[PP] Žádné zboží s typem "výrobek" — zobrazuji vše');
        this.products = this.allItems;
      }

      this.connected = true;
      this.loading = false;
      return this.products;

    } catch (err) {
      this.error = err.message;
      this.loading = false;
      throw err;
    }
  },

  // ---- Načíst pracoviště (pro budoucí mapování) ----
  async loadStages() {
    try {
      const data = await this.queryEntity('Stage');
      const items = this.extractArray(data);
      this.stages = items.map(item => ({
        id: item.id || item.ID,
        name: item.label || item.name || item.Name || ('Pracoviště ' + (item.id || '')),
        code: item.code || item.Code || item.referenceName || '',
        raw: item,
      }));
      return this.stages;
    } catch (e) {
      console.error('[PP] loadStages error:', e);
      return [];
    }
  },
};
