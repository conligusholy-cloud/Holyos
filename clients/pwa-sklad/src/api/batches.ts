// HolyOS PWA — picking (batches) API klient.

import { apiFetch } from './client';

export type BatchStatus = 'open' | 'picking' | 'done' | 'cancelled';
export type BatchItemStatus = 'pending' | 'picked' | 'short' | 'skipped';

export interface BatchSummary {
  id: number;
  number: string;
  status: BatchStatus;
  sector: string | null;
  assigned_to: number | null;
  note: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  assignee?: { id: number; first_name: string; last_name: string } | null;
  _count?: { items: number };
}

export interface BatchItem {
  id: number;
  batch_id: number;
  material_id: number;
  from_location_id: number | null;
  quantity: string | number;
  picked_quantity: string | number | null;
  status: BatchItemStatus;
  sort_order: number;
  picked_at: string | null;
  picked_by: number | null;
  material?: {
    id: number;
    code: string;
    name: string;
    unit: string | null;
    barcode: string | null;
  };
  from_location?: {
    id: number;
    label: string;
    barcode: string | null;
  } | null;
  picker?: { id: number; first_name: string; last_name: string } | null;
}

export interface BatchDetail extends BatchSummary {
  items: BatchItem[];
}

export interface PickInput {
  batch_item_id: number;
  picked_quantity: number;
  from_location_id?: number | null;
  client_uuid: string;
  note?: string | null;
}

export interface PickResult {
  item: BatchItem;
  move_id: number | null;
  auto_completed: boolean;
}

export async function listBatches(status?: BatchStatus): Promise<BatchSummary[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiFetch<BatchSummary[]>(`/api/wh/batches${qs}`);
}

export async function getBatch(id: number): Promise<BatchDetail> {
  return apiFetch<BatchDetail>(`/api/wh/batches/${id}`);
}

export async function pickBatchItem(batchId: number, input: PickInput): Promise<PickResult> {
  return apiFetch<PickResult>(`/api/wh/batches/${batchId}/pick`, {
    method: 'POST',
    body: input,
  });
}

export async function completeBatch(id: number): Promise<BatchSummary> {
  return apiFetch<BatchSummary>(`/api/wh/batches/${id}/complete`, {
    method: 'PATCH',
  });
}

export function numberOrZero(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function generateClientUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  const rnd = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${rnd()}${rnd()}-${rnd()}-4${rnd().slice(1)}-${rnd()}-${rnd()}${rnd()}${rnd()}`;
}
