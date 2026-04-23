// HolyOS PWA — write queue repo pro odložené pohyby.
//
// Pohyb vzniká v UI akcí (M3), okamžitě se zapíše sem jako `pending` s
// `client_uuid` (UUID v4 vygenerované klientem). Queue flusher ho pak
// pošle na /api/wh/moves. Backend má `client_uuid @unique`, takže resend
// je idempotentní (200 `_deduped: true` vs. 201 nové).

import { getDb, type QueuedMove, type QueueStatus } from './schema';

export interface NewMoveInput {
  type: string;
  material_id: number;
  warehouse_id: number;
  quantity: number;
  location_id?: number | null;
  from_location_id?: number | null;
  to_location_id?: number | null;
  document_id?: number | null;
  unit_price?: number | null;
  reference_type?: string | null;
  reference_id?: number | null;
  note?: string | null;
}

function generateUuid(): string {
  // crypto.randomUUID je v moderních prohlížečích i SUNMI L2H (Chromium).
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // fallback — jen pro testovací prostředí bez crypto
  const rnd = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${rnd()}${rnd()}-${rnd()}-4${rnd().slice(1)}-${rnd()}-${rnd()}${rnd()}${rnd()}`;
}

export async function enqueueMove(input: NewMoveInput): Promise<QueuedMove> {
  const db = await getDb();
  const record: QueuedMove = {
    client_uuid: generateUuid(),
    ...input,
    status: 'pending',
    created_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
    last_attempt_at: null,
    synced_at: null,
    server_move_id: null,
    deduped: false,
  };
  await db.put('write_queue', record);
  return record;
}

export async function listByStatus(status: QueueStatus): Promise<QueuedMove[]> {
  const db = await getDb();
  return db.getAllFromIndex('write_queue', 'by-status', status);
}

export async function listPending(): Promise<QueuedMove[]> {
  const items = await listByStatus('pending');
  // stabilní pořadí — FIFO podle created_at
  return items.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function listFailed(): Promise<QueuedMove[]> {
  return listByStatus('failed');
}

export async function countByStatus(status: QueueStatus): Promise<number> {
  const db = await getDb();
  return db.countFromIndex('write_queue', 'by-status', status);
}

export async function getMove(clientUuid: string): Promise<QueuedMove | null> {
  const db = await getDb();
  return (await db.get('write_queue', clientUuid)) ?? null;
}

interface PatchInput {
  status?: QueueStatus;
  last_error?: string | null;
  attempts?: number;
  last_attempt_at?: string | null;
  synced_at?: string | null;
  server_move_id?: number | null;
  deduped?: boolean;
}

export async function patchMove(clientUuid: string, patch: PatchInput): Promise<QueuedMove | null> {
  const db = await getDb();
  const tx = db.transaction('write_queue', 'readwrite');
  const current = await tx.store.get(clientUuid);
  if (!current) {
    await tx.done;
    return null;
  }
  const next: QueuedMove = { ...current, ...patch };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function markSyncing(clientUuid: string): Promise<QueuedMove | null> {
  return patchMove(clientUuid, {
    status: 'syncing',
    last_attempt_at: new Date().toISOString(),
  });
}

export async function markSynced(clientUuid: string, serverMoveId: number, deduped: boolean): Promise<QueuedMove | null> {
  return patchMove(clientUuid, {
    status: 'synced',
    synced_at: new Date().toISOString(),
    server_move_id: serverMoveId,
    deduped,
    last_error: null,
  });
}

export async function markFailed(clientUuid: string, error: string): Promise<QueuedMove | null> {
  const current = await getMove(clientUuid);
  return patchMove(clientUuid, {
    status: 'failed',
    last_error: error,
    attempts: (current?.attempts ?? 0) + 1,
  });
}

export async function revertToPending(clientUuid: string, error?: string | null): Promise<QueuedMove | null> {
  const current = await getMove(clientUuid);
  return patchMove(clientUuid, {
    status: 'pending',
    last_error: error ?? null,
    attempts: (current?.attempts ?? 0) + 1,
  });
}

export async function deleteMove(clientUuid: string): Promise<void> {
  const db = await getDb();
  await db.delete('write_queue', clientUuid);
}

export async function clearSynced(): Promise<number> {
  const db = await getDb();
  const synced = await db.getAllKeysFromIndex('write_queue', 'by-status', 'synced');
  const tx = db.transaction('write_queue', 'readwrite');
  await Promise.all(synced.map((key) => tx.store.delete(key)));
  await tx.done;
  return synced.length;
}
