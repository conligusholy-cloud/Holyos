// HolyOS PWA — flusher pending operací v offline queues.
//
// Tři queues:
//   - write_queue (moves)       → POST /api/wh/moves
//   - inventory_queue (counts)  → PUT /api/wh/inventories/:invId/items/:itemId
//   - pick_queue (picks)        → POST /api/wh/batches/:id/pick
//
// Kontrakty flushe:
//   - 2xx          :: markSynced
//   - 400          :: markFailed (neposílat znovu, dokud user neretrue ručně)
//   - 401          :: apiFetch auto-logout; zůstane pending (pokračuje po loginu)
//   - 0 (síť)/5xx  :: revertToPending, další flush to zkusí
//
// Pořadí flush je moves → inventory → pick — pohyby nejdřív aby stock byl
// konzistentní pro následné inventury/picky.

import { ApiError, apiFetch } from '../api/client';
import {
  listPending,
  markFailed,
  markSynced,
  markSyncing,
  revertToPending,
} from '../db/queueRepo';
import {
  listInventoryPending,
  markInventoryFailed,
  markInventorySynced,
  markInventorySyncing,
  revertInventoryToPending,
} from '../db/inventoryQueueRepo';
import {
  listPickPending,
  markPickFailed,
  markPickSynced,
  markPickSyncing,
  revertPickToPending,
} from '../db/pickQueueRepo';
import type { QueuedInventoryCount, QueuedMove, QueuedPick } from '../db/schema';

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

// ---------- Inventury --------------------------------------------------------

async function flushInventory(record: QueuedInventoryCount): Promise<'synced' | 'failed' | 'retrying'> {
  await markInventorySyncing(record.client_uuid);
  try {
    await apiFetch(
      `/api/wh/inventories/${record.inventory_id}/items/${record.item_id}`,
      {
        method: 'PUT',
        body: { actual_qty: record.actual_qty },
      }
    );
    await markInventorySynced(record.client_uuid);
    return 'synced';
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 0 || err.status >= 500) {
        await revertInventoryToPending(record.client_uuid, err.message);
        return 'retrying';
      }
      if (err.status === 401) {
        await revertInventoryToPending(record.client_uuid, 'Nepřihlášen');
        return 'retrying';
      }
      await markInventoryFailed(record.client_uuid, err.message);
      return 'failed';
    }
    await revertInventoryToPending(
      record.client_uuid,
      err instanceof Error ? err.message : 'Neznámá chyba'
    );
    return 'retrying';
  }
}

// ---------- Picks ------------------------------------------------------------

async function flushPick(record: QueuedPick): Promise<'synced' | 'failed' | 'retrying'> {
  await markPickSyncing(record.client_uuid);
  try {
    await apiFetch(`/api/wh/batches/${record.batch_id}/pick`, {
      method: 'POST',
      body: {
        batch_item_id: record.batch_item_id,
        picked_quantity: record.picked_quantity,
        from_location_id: record.from_location_id ?? undefined,
        client_uuid: record.client_uuid,
        note: record.note ?? undefined,
      },
    });
    await markPickSynced(record.client_uuid);
    return 'synced';
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 0 || err.status >= 500) {
        await revertPickToPending(record.client_uuid, err.message);
        return 'retrying';
      }
      if (err.status === 401) {
        await revertPickToPending(record.client_uuid, 'Nepřihlášen');
        return 'retrying';
      }
      await markPickFailed(record.client_uuid, err.message);
      return 'failed';
    }
    await revertPickToPending(
      record.client_uuid,
      err instanceof Error ? err.message : 'Neznámá chyba'
    );
    return 'retrying';
  }
}

// ---------- Orchestrátor -----------------------------------------------------

let running = false;

export async function flushPending(): Promise<FlushResult> {
  // Serializace — jeden flush per instance, ať backend nedostane duplicity
  // ze dvou paralelních requestů se stejným client_uuid (zbytečné dedup hity).
  if (running) {
    return { attempted: 0, synced: 0, deduped: 0, failed: 0, retrying: 0 };
  }
  running = true;
  try {
    const result: FlushResult = { attempted: 0, synced: 0, deduped: 0, failed: 0, retrying: 0 };

    // 1) Moves — stock musí být čerstvý před inventurou/pickingem
    const moves = await listPending();
    result.attempted += moves.length;
    for (const move of moves) {
      const outcome = await flushOne(move);
      result[outcome]++;
    }

    // 2) Inventura
    const counts = await listInventoryPending();
    result.attempted += counts.length;
    for (const count of counts) {
      const outcome = await flushInventory(count);
      result[outcome]++;
    }

    // 3) Picking
    const picks = await listPickPending();
    result.attempted += picks.length;
    for (const pick of picks) {
      const outcome = await flushPick(pick);
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
