// HolyOS PWA — inventura API klient.
//
// Endpointy (všechny JWT-auth):
//   GET  /api/wh/inventories                      — list
//   GET  /api/wh/inventories/:id                  — detail s items (material, location, counter)
//   PUT  /api/wh/inventories/:invId/items/:itemId — zapis actual_qty
//   POST /api/wh/inventories/:id/lock-locations   — zamknout lokace (v2)
//   POST /api/wh/inventories/:id/finish-v2        — dokončit + generate adjust pohyby

import { apiFetch } from './client';

export type InventoryStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled';

export interface InventorySummary {
  id: number;
  name: string | null;
  status: InventoryStatus;
  warehouse_id: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface InventoryItem {
  id: number;
  inventory_id: number;
  material_id: number;
  location_id: number | null;
  expected_qty: string | number;
  actual_qty: string | number | null;
  difference: string | number | null;
  unit_price: string | number | null;
  counted_at: string | null;
  material?: {
    id: number;
    code: string;
    name: string;
    unit: string | null;
  };
  location?: {
    id: number;
    label: string;
    section: string | null;
    rack: string | null;
    position: string | null;
  } | null;
  counter?: {
    id: number;
    first_name: string;
    last_name: string;
  } | null;
}

export interface InventoryDetail extends InventorySummary {
  warehouse: { id: number; name: string };
  items: InventoryItem[];
  creator?: { id: number; first_name: string; last_name: string } | null;
}

export interface FinishInventoryResult {
  inventory: InventorySummary;
  adjustments_count: number;
  skipped: { no_location: number; no_actual: number; no_diff: number };
  generated: Array<{
    item_id: number;
    move_id?: number;
    delta?: number;
    deduped?: boolean;
    error?: string;
  }>;
}

export async function listInventories(status?: InventoryStatus): Promise<InventorySummary[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiFetch<InventorySummary[]>(`/api/wh/inventories${qs}`);
}

export async function getInventory(id: number): Promise<InventoryDetail> {
  return apiFetch<InventoryDetail>(`/api/wh/inventories/${id}`);
}

export async function updateInventoryItem(
  invId: number,
  itemId: number,
  patch: { actual_qty: number }
): Promise<InventoryItem> {
  return apiFetch<InventoryItem>(`/api/wh/inventories/${invId}/items/${itemId}`, {
    method: 'PUT',
    body: patch,
  });
}

export async function lockInventoryLocations(id: number): Promise<{
  locked_count: number;
  location_ids?: number[];
}> {
  return apiFetch(`/api/wh/inventories/${id}/lock-locations`, { method: 'POST' });
}

export async function finishInventory(id: number): Promise<FinishInventoryResult> {
  return apiFetch<FinishInventoryResult>(`/api/wh/inventories/${id}/finish-v2`, {
    method: 'POST',
  });
}

export function numberOrZero(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
