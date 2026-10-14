// =============================================================================
// Podpora BS2 — zjištění, zda má přihlášený uživatel přístup (Tomáš a Jan Holý)
// =============================================================================
// Výsledek se drží v paměti procesu, ať se záložky nepřekreslují při každém focusu.

import { useEffect, useState } from 'react';
import { api } from './api';
import { loadAuth } from './auth';

let cached: boolean | null = null;

export function useSupportAllowed(): boolean {
  const [allowed, setAllowed] = useState<boolean>(cached === true);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const auth = await loadAuth();
        if (!auth.jwt) return;
        const r = await api.supportMe(auth.jwt);
        cached = !!r.allowed;
        if (alive) setAllowed(cached);
      } catch { /* bez sítě necháme poslední známou hodnotu */ }
    })();
    return () => { alive = false; };
  }, []);
  return allowed;
}

export function resetSupportAllowed(): void { cached = null; }
