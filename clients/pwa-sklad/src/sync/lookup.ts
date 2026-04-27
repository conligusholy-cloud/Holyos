// HolyOS PWA — lookup QR kódu na materiál / lokaci.
//
// Strategie:
//   1) Nejdřív rozpoznáme prefix (`mat-{id}`, `sto-{wh}-{code}`) a pošleme
//      strukturovaný dotaz (ID / warehouse+code). Jistý mapping na entitu.
//   2) Když prefix nesedí, zkusíme backend barcode lookup (dodavatelský EAN,
//      legacy Factorify kódy, atd.).
//   3) Když i backend padne sítí (offline, 5xx), sáhneme do IDB cache.
//   4) Při 404 vrátíme NotFoundError (jasné "není to u nás v systému").

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

// ---------------------------------------------------------------------------
// Prefix parsery — rozpoznají tvar QR kódu a vrátí strukturovanou identifikaci.
// `mat-{id}`             -> materiál podle ID
// `sto-{wh_id}-{code}`   -> lokace podle (warehouse_id, code)
// Ostatní                -> null (padne na barcode fallback)
// ---------------------------------------------------------------------------

function parseMaterialQr(raw: string): { id: number } | null {
  const m = raw.match(/^mat-(\d+)$/i);
  if (!m) return null;
  const id = parseInt(m[1], 10);
  return Number.isFinite(id) && id > 0 ? { id } : null;
}

function parseLocationQr(raw: string): { warehouseId: number; code: string } | null {
  // sto-{wh_id}-{code} — code může obsahovat písmena i pomlčky (A04A, A-04-A, ...)
  const m = raw.match(/^sto-(\d+)-(.+)$/i);
  if (!m) return null;
  const warehouseId = parseInt(m[1], 10);
  const code = m[2].trim();
  return Number.isFinite(warehouseId) && warehouseId > 0 && code ? { warehouseId, code } : null;
}

function toMaterialResult(res: ApiMaterialResponse): MaterialLookupResult {
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
}

// ---------------------------------------------------------------------------
// Materiál
// ---------------------------------------------------------------------------

export async function lookupMaterialByQr(qr: string): Promise<MaterialLookupResult> {
  const trimmed = qr.trim();
  if (!trimmed) throw new NotFoundError('material', qr);

  // 1) Prefix `mat-{id}` → lookup přes numerické ID
  const parsed = parseMaterialQr(trimmed);
  if (parsed) {
    try {
      const res = await apiFetch<ApiMaterialResponse>(`/api/wh/items/by-id/${parsed.id}`);
      return toMaterialResult(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw new NotFoundError('material', trimmed);
      }
      if (isNetworkish(err)) {
        // Offline fallback — v IDB cache hledáme podle ID přímo přes barcode index
        // není, ale máme getMaterial(id). Importujeme líně, ať nerozbíjíme bundle.
        const { getMaterial } = await import('../db/catalogRepo');
        const cached = await getMaterial(parsed.id);
        if (cached) return { source: 'cache', material: cached };
        throw new NotFoundError('material', trimmed);
      }
      throw err;
    }
  }

  // 2) Fallback — backend barcode lookup (EAN, legacy kódy)
  try {
    const res = await apiFetch<ApiMaterialResponse>(
      `/api/wh/items/by-qr/${encodeURIComponent(trimmed)}`
    );
    return toMaterialResult(res);
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

// ---------------------------------------------------------------------------
// Lokace
// ---------------------------------------------------------------------------

export async function lookupLocationByQr(qr: string): Promise<LocationLookupResult> {
  const trimmed = qr.trim();
  if (!trimmed) throw new NotFoundError('location', qr);

  // 1) Prefix `sto-{wh}-{code}` → lookup přes (warehouse_id, code)
  const parsed = parseLocationQr(trimmed);
  if (parsed) {
    try {
      const url =
        `/api/wh/locations/by-code?warehouse_id=${parsed.warehouseId}` +
        `&code=${encodeURIComponent(parsed.code)}`;
      const res = await apiFetch<CachedLocation>(url);
      return { source: 'api', location: res };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw new NotFoundError('location', trimmed);
      }
      if (isNetworkish(err)) {
        // Offline — v IDB cache zkusíme najít lokaci s odpovídajícím kódem
        // (label nebo position). Hrubá heuristika, ale pro pár set lokací stačí.
        const { findLocationByCode } = await import('../db/catalogRepo');
        const cached = await findLocationByCode(parsed.warehouseId, parsed.code);
        if (cached) return { source: 'cache', location: cached };
        throw new NotFoundError('location', trimmed);
      }
      throw err;
    }
  }

  // 2) Fallback — backend barcode lookup
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
