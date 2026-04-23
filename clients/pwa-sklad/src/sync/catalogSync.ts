// HolyOS PWA — pull katalogu (materials delta + locations full) do IDB.

import { apiFetch } from '../api/client';
import { upsertLocations, upsertMaterials } from '../db/catalogRepo';
import { getMeta, setMeta } from '../db/metaRepo';
import type { CachedLocation, CachedMaterial } from '../db/schema';

interface SyncResponse<T> {
  items: T[];
  server_time: string;
  count: number;
}

export interface CatalogSyncResult {
  materials: { fetched: number; serverTime: string };
  locations: { fetched: number; serverTime: string };
}

export async function pullMaterials(options: { reset?: boolean } = {}): Promise<{
  fetched: number;
  serverTime: string;
}> {
  const since = options.reset ? null : await getMeta('last_materials_sync');
  const url = since
    ? `/api/wh/sync/materials?since=${encodeURIComponent(since)}`
    : '/api/wh/sync/materials';

  const res = await apiFetch<SyncResponse<CachedMaterial>>(url);
  await upsertMaterials(res.items);
  await setMeta('last_materials_sync', res.server_time);
  return { fetched: res.items.length, serverTime: res.server_time };
}

export async function pullLocations(): Promise<{ fetched: number; serverTime: string }> {
  // Lokací je málo → vždycky full refresh, nepotřebuje delta.
  const res = await apiFetch<SyncResponse<CachedLocation>>('/api/wh/sync/locations');
  await upsertLocations(res.items);
  await setMeta('last_locations_sync', res.server_time);
  return { fetched: res.items.length, serverTime: res.server_time };
}

export async function pullCatalog(options: { reset?: boolean } = {}): Promise<CatalogSyncResult> {
  const [materials, locations] = await Promise.all([
    pullMaterials(options),
    pullLocations(),
  ]);
  return { materials, locations };
}
