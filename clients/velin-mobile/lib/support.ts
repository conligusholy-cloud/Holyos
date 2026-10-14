// =============================================================================
// Podpora BS2 — zjištění, zda má přihlášený uživatel přístup (Tomáš a Jan Holý)
// =============================================================================
// Výsledek se drží v paměti procesu, ať se záložky nepřekreslují při každém focusu.

import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
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

// Počet nepřečtených zpráv podpory — obnovuje se sám každých 6 s a při návratu do aplikace.
export function useSupportUnread(enabled: boolean): number {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = async () => {
      try {
        const auth = await loadAuth();
        if (!auth.jwt) return;
        const r = await api.supportThreads(auth.jwt);
        if (alive) setUnread(r.threads.reduce((s, t) => s + (t.unread || 0), 0));
      } catch { /* bez sítě nic */ }
    };
    tick();
    const t = setInterval(tick, 6000);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') tick(); });
    return () => { alive = false; clearInterval(t); sub.remove(); };
  }, [enabled]);
  return unread;
}
