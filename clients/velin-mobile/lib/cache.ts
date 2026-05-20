// =============================================================================
// Velín mobile — JSON cache (AsyncStorage)
// =============================================================================
// Stale-while-revalidate pattern: ukládáme poslední úspěšnou odpověď z API,
// při dalším otevření ji rovnou zobrazíme (instantní render) a na pozadí
// refreshujeme. Když API selže, uživatel vidí poslední známá data místo
// prázdné obrazovky se spinnerem.
//
// Data tady nejsou citlivá (úkoly, plány), takže nepotřebujeme SecureStore
// (šifrovaný Keychain). AsyncStorage je standardní RN persistence, větší
// kapacita, rychlejší.
//
// Tvar uložené hodnoty:
//   { savedAt: <ISO timestamp>, value: <T> }
// savedAt slouží k zobrazení "naposledy obnoveno před X minutami" a k volnému
// expirování (volající si rozhodne, jestli stará data ještě stojí za zobrazení).

import AsyncStorage from '@react-native-async-storage/async-storage';

export type CacheEntry<T> = {
  savedAt: string; // ISO 8601
  value: T;
};

const KEY_PREFIX = 'velin_cache:';

export async function setCache<T>(key: string, value: T): Promise<void> {
  const entry: CacheEntry<T> = { savedAt: new Date().toISOString(), value };
  try {
    await AsyncStorage.setItem(KEY_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Tichý fail — cache je optimalizace, ne kritická cesta.
  }
}

export async function getCache<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!parsed || typeof parsed.savedAt !== 'string') return null;
    return parsed;
  } catch {
    // Malformed data nebo storage error → vrátíme null, ne crash.
    return null;
  }
}

export async function clearCache(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY_PREFIX + key);
  } catch {
    // Tichý fail.
  }
}

// Hezky formátované "naposledy obnoveno":
//   <30 s    → "právě teď"
//   <60 min  → "před N min"
//   jinak    → "v HH:MM"
export function formatCacheAge(savedAt: string): string {
  const ts = new Date(savedAt).getTime();
  if (Number.isNaN(ts)) return '';
  const diffSec = Math.max(0, (Date.now() - ts) / 1000);
  if (diffSec < 30) return 'právě teď';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `před ${diffMin} min`;
  return new Date(ts).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}
