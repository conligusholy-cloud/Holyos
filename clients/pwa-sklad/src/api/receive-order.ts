// HolyOS PWA — Příjem podle nákupní objednávky
// Endpoints:
//   GET  /api/wh/pwa/receive/orders?q=&supplier_id=
//   GET  /api/wh/pwa/receive/suppliers?q=
//   GET  /api/wh/pwa/receive/orders/:id
//   POST /api/wh/pwa/receive/orders/:id   { location_id, lines:[{order_item_id, quantity}], note, client_uuid }

import { apiFetch } from './client';

export interface PoSummary {
  id: number;
  order_number: string;
  status: string;
  type: string;
  company: { id: number; name: string } | null;
  expected_delivery: string | null;
  created_at: string;
  items_total: number;
  items_open: number;
  supplier_confirm_status: string | null;
}

export interface PoSupplier {
  id: number;
  name: string;
  orders: number;
  items_open: number;
}

export interface PoItem {
  id: number;
  name: string;
  material_id: number | null;
  material_code: string | null;
  barcode: string | null;
  unit: string;
  quantity: number;
  delivered_quantity: number;
  remaining: number;
  expected_delivery: string | null;
  confirmed_delivery: string | null;
}

export interface PoDetail extends PoSummary {
  items: PoItem[];
}

export interface ReceiveResult {
  ok: boolean;
  document_number: string;
  document_id: number;
  order_status: string;
  received: { item_id: number; name: string; quantity: number }[];
  location: string;
  invoices_linked: number;
}

export function searchOrders(q: string, supplierId?: number): Promise<PoSummary[]> {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (supplierId) p.set('supplier_id', String(supplierId));
  return apiFetch<PoSummary[]>('/api/wh/pwa/receive/orders?' + p.toString());
}

export function listSuppliers(q: string): Promise<PoSupplier[]> {
  return apiFetch<PoSupplier[]>('/api/wh/pwa/receive/suppliers' + (q ? '?q=' + encodeURIComponent(q) : ''));
}

export function getOrder(id: number): Promise<PoDetail> {
  return apiFetch<PoDetail>('/api/wh/pwa/receive/orders/' + id);
}

export function receiveOrder(id: number, input: { location_id: number; lines: { order_item_id: number; quantity: number }[]; note?: string; client_uuid: string }): Promise<ReceiveResult> {
  // apiFetch sám serializuje body do JSON — nepředávat JSON.stringify
  return apiFetch<ReceiveResult>('/api/wh/pwa/receive/orders/' + id, { method: 'POST', body: input });
}
