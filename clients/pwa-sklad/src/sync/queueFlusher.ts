// HolyOS PWA — flusher pending pohybů na /api/wh/moves.
//
// Kontrakty:
//   - 201 Created  :: nový pohyb, backend vrátil svůj id
//   - 200 OK       :: dedup hit (stejný client_uuid už dřív prošel), body má
//                     `_deduped: true`; ze strany PWA to je OK stejně jako 201.
//   - 400          :: validační / business chyba → markFailed (neposílat znovu,
//                     dokud uživatel v debug UI nezopakuje ručně)
//   - 401          :: apiFetch auto-loguje uživatele; record zůstane pending
//   - 0 (síť) / 5xx:: revertToPending, další flush to zkusí znovu

import { ApiError, apiFetch } from '../api/client';
import {
  listPending,
  markFailed,
  markSynced,
  markSyncing,
  revertToPending,
} from '../db/queueRepo';
import type { QueuedMove } from '../db/schema';

interface MoveResponse {
  id: number;
  _deduped?: boolean;
}

export interface FlushResult {
  attempted: number;
  synced: number;
  deduped: number;
  failed: number;
  retrying: number;
}

function toPayload(move: QueuedMove) {
  // Posíláme jen pole definovaná backend moveInputSchema (viz warehouse-v2.routes.js).
  const payload: Record<string, unknown> = {
    client_uuid: move.client_uuid,
    type: move.type,
    material_id: move.material_id,
    warehouse_id: move.warehouse_id,
    quantity: move.quantity,
  };
  if (move.location_id != null) payload.location_id = move.location_id;
  if (move.from_location_id != null) payload.from_location_id = move.from_location_id;
  if (move.to_location_id != null) payload.to_location_id = move.to_location_id;
  if (move.document_id != null) payload.document_id = move.document_id;
  if (move.unit_price != null) payload.unit_price = move.unit_price;
  if (move.reference_type != null) payload.reference_type = move.reference_type;
  if (move.reference_id != null) payload.reference_id = move.reference_id;
  if (move.note != null) payload.note = move.note;
  return payload;
}

async function flushOne(move: QueuedMove): Promise<'synced' | 'deduped' | 'failed' | 'retrying'> {
  await markSyncing(move.client_uuid);
  try {
    const response = await apiFetch<MoveResponse>('/api/wh/moves', {
      method: 'POST',
      body: toPayload(move),
    });
    const deduped = response._deduped === true;
    await markSynced(move.client_uuid, response.id, deduped);
    return deduped ? 'deduped' : 'synced';
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 0) {
        // síťová chyba — necháme pending, další flush to zkusí
        await revertToPending(move.client_uuid, err.message);
        return 'retrying';
      }
      if (err.status >= 500) {
        await revertToPending(move.client_uuid, err.message);
        return 'retrying';
      }
      if (err.status === 401) {
        // auto-logout už přišel přes apiFetch; necháme pending
        await revertToPending(move.client_uuid, 'Nepřihlášen — po loginu to zkusíme znovu');
        return 'retrying';
      }
      // 4xx mimo 401 — neopravíme retrycem, označíme failed
      await markFailed(move.client_uuid, err.message);
      return 'failed';
    }
    const message = err instanceof Error ? err.message : 'Neznámá chyba';
    await revertToPending(move.client_uuid, message);
    return 'retrying';
  }
}

let running = false;

export async function flushPending(): Promise<FlushResult> {
  // Serializace — jeden flush per instance, ať backend nedostane duplicity
  // ze dvou paralelních requestů se stejným client_uuid (zbytečné dedup hity).
  if (running) {
    return { attempted: 0, synced: 0, deduped: 0, failed: 0, retrying: 0 };
  }
  running = true;
  try {
    const pending = await listPending();
    const result: FlushResult = {
      attempted: pending.length,
      synced: 0,
      deduped: 0,
      failed: 0,
      retrying: 0,
    };
    for (const move of pending) {
      const outcome = await flushOne(move);
      result[outcome]++;
    }
    return result;
  } finally {
    running = false;
  }
}

export function isFlushRunning(): boolean {
  return running;
}
