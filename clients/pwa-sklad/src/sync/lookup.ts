// HolyOS PWA — lookup QR kódu na materiál / lokaci.
//
// Strategie: nejdřív zkusíme backend (má navíc stock_by_location, last_movements).
// Pokud padne na síti (offline, 5xx), sáhneme do IDB cache. Při 404 vrátíme
// null (kód neexistuje, nemá smysl hledat dál). Při 4xx jiné než 404 vrátíme
// chybu — to naznačuje něco opravdu špatně (auth, invalid format).

import { ApiError, apiFetch } from '../api/client';
import { findLocationByBarcode, findMaterialByBarcode } from '../db/catalogRepo';
import type { CachedLocation, CachedMaterial } from '../db/schema';

export interface MaterialLookupResult {
  source: 'api' | 'cache';
  material: CachedMaterial;
  // Extra pole z API odpovědi, která cache nemá. Při offline undefined.
  stockByLocation?: Array<{
    location_id: number | null;
    quantity: number;
    location?: { id: number; label: string; warehouse_id: number; type: string | null };
  }>;
  lastMovements?: unknown[];
}

export interface LocationLookupResult {
  source: 'api' | 'cache';
  location: CachedLocation;
}

interface ApiMaterialResponse extends CachedMaterial {
  stock_by_location?: MaterialLookupResult['stockByLocation'];
  last_movements?: unknown[];
}

export class NotFoundError extends Error {
  constructor(public kind: 'material' | 'location', public qr: string) {
    super(`${kind === 'material' ? 'Materiál' : 'Lokace'} s QR "${qr}" neexistuje`);
    this.name = 'NotFoundError';
  }
}

function isNetworkish(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return err.status === 0 || err.status >= 500 || err.status === 401;
}

export async function lookupMaterialByQr(qr: string): Promise<MaterialLookupResult> {
  const trimmed = qr.trim();
  if (!trimmed) throw new NotFoundError('material', qr);

  try {
    const res = await apiFetch<ApiMaterialResponse>(
      `/api/wh/items/by-qr/${encodeURIComponent(trimmed)}`
    );
    return {
      source: 'api',
      material: {
        id: res.id,
        code: res.code,
        name: res.name,
        barcode: res.barcode ?? null,
        unit: res.unit ?? null,
        sector: res.sector ?? null,
        current_stock: res.current_stock ?? 0,
        min_stock: res.min_stock ?? null,
        updated_at: res.updated_at ?? new Date().toISOString(),
      },
      stockByLocation: res.stock_by_location,
      lastMovements: res.last_movements,
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // 404 = kód neexistuje. Nechceme fallback na cache, která by ukázala
      // něco smazaného nebo staré. Jasná odpověď „není to u nás v systému".
      throw new NotFoundError('material', trimmed);
    }
    if (isNetworkish(err)) {
      const cached = await findMaterialByBarcode(trimmed);
      if (cached) return { source: 'cache', material: cached };
      throw new NotFoundError('material', trimmed);
    }
    throw err;
  }
}

export async function lookupLocationByQr(qr: string): Promise<LocationLookupResult> {
  const trimmed = qr.trim();
  if (!trimmed) throw new NotFoundError('location', qr);

  try {
    const res = await apiFetch<CachedLocation>(
      `/api/wh/locations/by-qr/${encodeURIComponent(trimmed)}`
    );
    return { source: 'api', location: res };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new NotFoundError('location', trimmed);
    }
    if (isNetworkish(err)) {
      const cached = await findLocationByBarcode(trimmed);
      if (cached) return { source: 'cache', location: cached };
      throw new NotFoundError('location', trimmed);
    }
    throw err;
  }
}
