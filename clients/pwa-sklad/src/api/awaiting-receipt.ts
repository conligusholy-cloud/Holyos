// HolyOS PWA — Faktury čekající na příjem (Fáze 12)
// Endpoints:
//   GET /api/wh/pwa/awaiting-receipt
//   GET /api/wh/pwa/awaiting-receipt/by-qr/:qr
//   POST /api/wh/pwa/awaiting-receipt/:invoiceId/confirm

import { apiFetch } from './client';

export interface AwaitingItem {
  id: number;
  material_name: string | null;
  material_code: string | null;
  material_qr: string | null;
  quantity: number;
  unit: string;
}

export interface AwaitingInvoice {
  id: number;
  invoice_number: string;
  external_number: string | null;
  company: string | null;
  ico: string | null;
  order_number: string | null;
  order_id: number;
  date_issued: string;
  date_received: string | null;
  total: number;
  currency: string;
  status: string;
  items: AwaitingItem[];
}

export interface ConfirmReceiptInput {
  warehouse_id: number;
  qr_codes?: string[];
  note?: string;
}

export interface ConfirmReceiptResult {
  ok: boolean;
  warehouse_document_id: number;
  document_number: string;
  invoice_number: string;
  new_invoice_status: string;
}

export interface ByQrResult {
  material: { id: number; name: string; code: string };
  candidate_invoices: Array<{
    id: number;
    invoice_number: string;
    company: string | null;
    order_number: string | null;
    total: number;
  }>;
}

export async function listAwaitingReceipt(): Promise<AwaitingInvoice[]> {
  return apiFetch<AwaitingInvoice[]>('/api/wh/pwa/awaiting-receipt');
}

export async function findByQr(qrCode: string): Promise<ByQrResult> {
  return apiFetch<ByQrResult>(
    `/api/wh/pwa/awaiting-receipt/by-qr/${encodeURIComponent(qrCode)}`
  );
}

export async function confirmReceipt(
  invoiceId: number,
  input: ConfirmReceiptInput
): Promise<ConfirmReceiptResult> {
  return apiFetch<ConfirmReceiptResult>(
    `/api/wh/pwa/awaiting-receipt/${invoiceId}/confirm`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
}
