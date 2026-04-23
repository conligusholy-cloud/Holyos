// HolyOS PWA — centrální sync kontext.
//
// Drží stav: online, pending/failed counts, last sync timestamps katalogu.
// Exposuje akce: refreshCatalog(), flushQueue(), refreshStats().
// Auto-flush se spouští při přechodu offline→online a při každém refreshStats(),
// který volají relevantní místa (enqueue pohybu, otevření dashboardu, ...).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '../auth/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { countLocations, countMaterials } from '../db/catalogRepo';
import { countByStatus } from '../db/queueRepo';
import { getAllMeta } from '../db/metaRepo';
import { pullCatalog, type CatalogSyncResult } from './catalogSync';
import { flushPending, type FlushResult } from './queueFlusher';

export interface SyncStats {
  online: boolean;
  pendingCount: number;
  failedCount: number;
  syncingCount: number;
  materialsCount: number;
  locationsCount: number;
  lastMaterialsSync: string | null;
  lastLocationsSync: string | null;
}

interface SyncContextValue {
  stats: SyncStats;
  catalogBusy: boolean;
  queueBusy: boolean;
  refreshStats: () => Promise<void>;
  refreshCatalog: (options?: { reset?: boolean }) => Promise<CatalogSyncResult>;
  flushQueue: () => Promise<FlushResult>;
}

const defaultStats: SyncStats = {
  online: true,
  pendingCount: 0,
  failedCount: 0,
  syncingCount: 0,
  materialsCount: 0,
  locationsCount: 0,
  lastMaterialsSync: null,
  lastLocationsSync: null,
};

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { status: authStatus } = useAuth();
  const online = useOnlineStatus();

  const [stats, setStats] = useState<SyncStats>(defaultStats);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);

  const lastOnline = useRef(online);
  const initialSyncDone = useRef(false);

  const refreshStats = useCallback(async () => {
    try {
      const [pendingCount, failedCount, syncingCount, materialsCount, locationsCount, meta] =
        await Promise.all([
          countByStatus('pending'),
          countByStatus('failed'),
          countByStatus('syncing'),
          countMaterials(),
          countLocations(),
          getAllMeta(),
        ]);
      setStats({
        online,
        pendingCount,
        failedCount,
        syncingCount,
        materialsCount,
        locationsCount,
        lastMaterialsSync: meta.last_materials_sync ?? null,
        lastLocationsSync: meta.last_locations_sync ?? null,
      });
    } catch (err) {
      // IDB občas selže na iOS/soukromý režim — nepadáme, jen zůstane default
      console.warn('[holyos-pwa] refreshStats failed', err);
    }
  }, [online]);

  useEffect(() => {
    // Odraz online stavu do SyncStats bez čekání na refreshStats.
    setStats((prev) => ({ ...prev, online }));
  }, [online]);

  const refreshCatalog = useCallback(async (options: { reset?: boolean } = {}) => {
    setCatalogBusy(true);
    try {
      const result = await pullCatalog(options);
      await refreshStats();
      return result;
    } finally {
      setCatalogBusy(false);
    }
  }, [refreshStats]);

  const flushQueue = useCallback(async () => {
    setQueueBusy(true);
    try {
      const result = await flushPending();
      await refreshStats();
      return result;
    } finally {
      setQueueBusy(false);
    }
  }, [refreshStats]);

  // Po přihlášení: první refresh statistik, a pokud je katalog prázdný,
  // natáhni ho. Flush pending udělá tiše, když je online.
  useEffect(() => {
    if (authStatus !== 'authenticated' || initialSyncDone.current) return;
    initialSyncDone.current = true;

    (async () => {
      await refreshStats();
      if (!online) return;
      try {
        const [mCount, lCount] = await Promise.all([countMaterials(), countLocations()]);
        if (mCount === 0 || lCount === 0) {
          await refreshCatalog();
        }
        await flushQueue();
      } catch (err) {
        console.warn('[holyos-pwa] initial sync failed', err);
      }
    })();
  }, [authStatus, online, refreshStats, refreshCatalog, flushQueue]);

  // Reset gate po logoutu.
  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      initialSyncDone.current = false;
    }
  }, [authStatus]);

  // Přechod offline→online → auto-flush
  useEffect(() => {
    if (lastOnline.current === online) return;
    lastOnline.current = online;
    if (online && authStatus === 'authenticated') {
      flushQueue().catch((err) => console.warn('[holyos-pwa] auto-flush failed', err));
    }
  }, [online, authStatus, flushQueue]);

  const value = useMemo<SyncContextValue>(
    () => ({ stats, catalogBusy, queueBusy, refreshStats, refreshCatalog, flushQueue }),
    [stats, catalogBusy, queueBusy, refreshStats, refreshCatalog, flushQueue]
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync musí být uvnitř <SyncProvider>');
  return ctx;
}
