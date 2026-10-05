// HolyOS PWA — Příprava materiálu pro výrobu (pokyny ze plánu: co, kam, na kdy)
// Endpoints:
//   GET    /api/planning/material-tasks?from=&to=        — úkoly přípravy (materiál na pracoviště + přesun WIP)
//   POST   /api/planning/material-tasks/done {key}         — označit „připraveno"
//   DELETE /api/planning/material-tasks/done {key}         — vrátit zpět
//   POST   /api/planning/batch-operations/:id/pull-earlier — posunout výrobu dřív (když je vše připraveno a lidé volní)

import { apiFetch } from './client';

export type PrepKind = 'material' | 'wip';
export type PrepStatus = 'ok' | 'partial' | 'no_stock' | 'no_target' | 'prepared';

export interface PrepPlace {
  workstation?: { id: number; name: string } | null;
  warehouse?: { id: number; name: string; code?: string | null } | null;
  location?: { id: number; label: string } | null;
  available?: number;
}

export interface PrepTask {
  key: string;
  prepared: boolean;
  prepared_at: string | null;
  kind: PrepKind;
  due: string;
  start_at: string;
  after?: string | null;
  status: PrepStatus;
  batch: { id: number; batch_number: string; is_test?: boolean; product: { id: number; code: string; name: string } };
  operation: { id: number; step: number; name: string; batch_operation_id: number; prev_step?: number; prev_name?: string };
  item: { type: 'material' | 'wip'; id: number; code: string; name: string };
  qty: number;
  unit: string;
  from: PrepPlace | null;
  to: PrepPlace | null;
  on_site?: number;
}

export interface PrepResponse {
  from: string;
  to: string;
  lead_minutes: number;
  operations_checked: number;
  tasks: PrepTask[];
}

export interface PullEarlierResult {
  ok: boolean;
  moved: boolean;
  reason?: string;
  from?: string;
  to_start?: string;
  to_end?: string;
  planned_start?: string;
  planned_end?: string;
  operation?: { id: number; name: string; step: number };
  batch?: string;
}

export async function listPrepTasks(days = 7): Promise<PrepResponse> {
  const from = new Date(Date.now() - 86400000).toISOString();
  const to = new Date(Date.now() + days * 86400000).toISOString();
  return apiFetch<PrepResponse>(`/api/planning/material-tasks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

export async function markPrepared(key: string, qty?: number): Promise<void> {
  await apiFetch('/api/planning/material-tasks/done', { method: 'POST', body: { key, qty } });
}

export async function unmarkPrepared(key: string): Promise<void> {
  await apiFetch('/api/planning/material-tasks/done', { method: 'DELETE', body: { key } });
}

export async function pullEarlier(batchOperationId: number): Promise<PullEarlierResult> {
  return apiFetch<PullEarlierResult>(`/api/planning/batch-operations/${batchOperationId}/pull-earlier`, { method: 'POST', body: {} });
}
