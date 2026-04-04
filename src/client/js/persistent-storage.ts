/* ============================================
   persistent-storage.ts — Persistentní úložiště

   Nahrazuje localStorage zápisem do JSON souborů
   přes proxy-server.js (port 3001).

   Automaticky synchronizuje localStorage ↔ soubor:
   - Při čtení: načte ze souboru, uloží do localStorage jako cache
   - Při zápisu: uloží do souboru i localStorage
   - Fallback: pokud server neběží, použije localStorage
   ============================================ */

interface PersistentStorageInterface {
  getItem(key: string): Promise<string>;
  getItemSync(key: string): string | null;
  setItem(key: string, data: string | Record<string, unknown> | any[]): Promise<boolean>;
  init(keys: string | string[]): Promise<void>;
  migrateFromLocalStorage(keys: string | string[]): Promise<string[]>;
  isServerAvailable(): boolean | null;
}

class PersistentStorageImpl implements PersistentStorageInterface {
  private SERVER_URL: string;
  private _cache: Record<string, string> = {};
  private _serverAvailable: boolean | null = null; // null = neznámo, true/false

  constructor() {
    this.SERVER_URL = window.location.origin;
  }

  // ==========================================
  // Interní: HTTP požadavky
  // ==========================================
  private async httpGet(key: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(`${this.SERVER_URL}/storage/${key}`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        this._serverAvailable = true;
        return await response.text();
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      clearTimeout(timeoutId);
      this._serverAvailable = false;
      throw new Error(
        error instanceof Error ? error.message : 'Network error'
      );
    }
  }

  private async httpPost(key: string, data: string): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${this.SERVER_URL}/storage/${key}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: data,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        this._serverAvailable = true;
        return true;
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      clearTimeout(timeoutId);
      this._serverAvailable = false;
      throw new Error(
        error instanceof Error ? error.message : 'Network error'
      );
    }
  }

  // ==========================================
  // Synchronní čtení (z cache/localStorage)
  // Na pozadí stáhne ze souboru a aktualizuje
  // ==========================================
  public getItemSync(key: string): string | null {
    // 1. Zkus cache
    if (this._cache[key] !== undefined) return this._cache[key];
    // 2. Zkus localStorage
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        this._cache[key] = raw;
        return raw;
      }
    } catch (e) {
      // localStorage not available
    }
    return null;
  }

  // ==========================================
  // Asynchronní čtení (ze souboru, pak cache)
  // ==========================================
  public async getItem(key: string): Promise<string> {
    try {
      const data = await this.httpGet(key);
      this._cache[key] = data;
      // Sync do localStorage jako cache
      try {
        localStorage.setItem(key, data);
      } catch (e) {
        // localStorage not available
      }
      return data;
    } catch (error) {
      // Fallback na localStorage
      console.warn('[PersistentStorage] Server nedostupný, používám localStorage pro:', key);
      try {
        const raw = localStorage.getItem(key);
        return raw || '[]';
      } catch (e) {
        return '[]';
      }
    }
  }

  // ==========================================
  // Zápis (do souboru + localStorage + cache)
  // ==========================================
  public async setItem(
    key: string,
    data: string | Record<string, unknown> | any[]
  ): Promise<boolean> {
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data);

    // Okamžitě do cache a localStorage
    this._cache[key] = dataStr;
    try {
      localStorage.setItem(key, dataStr);
    } catch (e) {
      // localStorage not available
    }

    // Na pozadí do souboru
    try {
      await this.httpPost(key, dataStr);
      console.log('[PersistentStorage] Uloženo do souboru:', key);
      return true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.warn('[PersistentStorage] Nelze uložit do souboru:', key, errMsg);
      console.warn('[PersistentStorage] Data jsou v localStorage (dočasně).');
      return false;
    }
  }

  // ==========================================
  // Inicializace: načíst data ze serveru do localStorage
  // Volat při startu každého modulu
  // ==========================================
  public async init(keys: string | string[]): Promise<void> {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    const promises = keyArray.map(async (key: string) => {
      try {
        const data = await this.getItem(key);
        console.log(
          '[PersistentStorage] Načteno:',
          key,
          `(${data ? data.length : 0} bytes)`
        );
      } catch (error) {
        console.error('[PersistentStorage] Chyba při načítání:', key, error);
      }
    });
    await Promise.all(promises);
  }

  // ==========================================
  // Migrace: pokud jsou data jen v localStorage,
  // zkopíruje je do souboru
  // ==========================================
  public async migrateFromLocalStorage(keys: string | string[]): Promise<string[]> {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    const results = await Promise.all(
      keyArray.map(async (key: string): Promise<string> => {
        try {
          const fileData = await this.httpGet(key);
          // Soubor existuje a má data — nemusíme migrovat
          if (fileData && fileData !== '[]' && fileData.length > 2) {
            // Sync do localStorage
            try {
              localStorage.setItem(key, fileData);
            } catch (e) {
              // localStorage not available
            }
            return 'file-ok';
          }
          // Soubor je prázdný, zkus localStorage
          try {
            const lsData = localStorage.getItem(key);
            if (lsData && lsData !== '[]' && lsData.length > 2) {
              await this.httpPost(key, lsData);
              console.log(
                '[PersistentStorage] Migrováno z localStorage do souboru:',
                key
              );
              return 'migrated';
            }
          } catch (e) {
            // localStorage not available
          }
          return 'empty';
        } catch (error) {
          return 'server-unavailable';
        }
      })
    );
    return results;
  }

  // ==========================================
  // Server availability check
  // ==========================================
  public isServerAvailable(): boolean | null {
    return this._serverAvailable;
  }
}

// ==========================================
// Veřejné API - singleton instance
// ==========================================
export const PersistentStorage: PersistentStorageInterface = new PersistentStorageImpl();
