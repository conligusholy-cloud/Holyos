// HolyOS PWA — API klient pro šarže (MaterialLot).

import { apiFetch } from './client';

export type LotStatus = 'in_stock' | 'consumed' | 'expired' | 'scrapped';

export interface LotStockRow {
  location_id: number;
  quantity: string | number;
  location?: { id: number; label: string } | null;
}

export interface MaterialLot {
  id: number;
  material_id: number;
  lot_code: string;
  status: LotStatus;
  manufactured_at: string | null;
  expires_at: string | null;
  supplier_id: number | null;
  supplier_lot_ref: string | null;
  received_at: string | null;
  note: string | null;
  stock_rows?: LotStockRow[];
}

export async function listLotsForMaterial(
  materialId: number,
  params: { status?: LotStatus; expiringWithinDays?: number } = {}
): Promise<MaterialLot[]> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.expiringWithinDays != null) qs.set('expiringWithinDays', String(params.expiringWithinDays));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<MaterialLot[]>(`/api/wh/materials/${materialId}/lots${suffix}`);
}

export function numberOrZero(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
