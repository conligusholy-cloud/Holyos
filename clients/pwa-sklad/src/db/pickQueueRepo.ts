// HolyOS PWA — queue pro picking (offline safe)
import { getDb, type QueuedPick, type QueueStatus } from './schema';

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  const rnd = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${rnd()}${rnd()}-${rnd()}-4${rnd().slice(1)}-${rnd()}-${rnd()}${rnd()}${rnd()}`;
}

export interface NewPick {
  batch_id: number;
  batch_item_id: number;
  picked_quantity: number;
  from_location_id?: number | null;
  note?: string | null;
}

export async function enqueuePick(input: NewPick): Promise<QueuedPick> {
  const db = await getDb();
  const record: QueuedPick = {
    client_uuid: generateUuid(),
    ...input,
    status: 'pending',
    created_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
    last_attempt_at: null,
    synced_at: null,
  };
  await db.put('pick_queue', record);
  return record;
}

export async function listPickByStatus(status: QueueStatus): Promise<QueuedPick[]> {
  const db = await getDb();
  return db.getAllFromIndex('pick_queue', 'by-status', status);
}

export async function listPickPending(): Promise<QueuedPick[]> {
  const items = await listPickByStatus('pending');
  return items.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function countPickByStatus(status: QueueStatus): Promise<number> {
  const db = await getDb();
  return db.countFromIndex('pick_queue', 'by-status', status);
}

interface PickPatch {
  status?: QueueStatus;
  last_error?: string | null;
  attempts?: number;
  last_attempt_at?: string | null;
  synced_at?: string | null;
}

export async function patchPick(client_uuid: string, patch: PickPatch): Promise<QueuedPick | null> {
  const db = await getDb();
  const tx = db.transaction('pick_queue', 'readwrite');
  const current = await tx.store.get(client_uuid);
  if (!current) {
    await tx.done;
    return null;
  }
  const next: QueuedPick = { ...current, ...patch };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function markPickSyncing(uuid: string) {
  return patchPick(uuid, { status: 'syncing', last_attempt_at: new Date().toISOString() });
}
export async function markPickSynced(uuid: string) {
  return patchPick(uuid, { status: 'synced', synced_at: new Date().toISOString(), last_error: null });
}
export async function markPickFailed(uuid: string, err: string) {
  const db = await getDb();
  const current = await db.get('pick_queue', uuid);
  return patchPick(uuid, {
    status: 'failed',
    last_error: err,
    attempts: (current?.attempts ?? 0) + 1,
  });
}
export async function revertPickToPending(uuid: string, err?: string | null) {
  const db = await getDb();
  const current = await db.get('pick_queue', uuid);
  return patchPick(uuid, {
    status: 'pending',
    last_error: err ?? null,
    attempts: (current?.attempts ?? 0) + 1,
  });
}

export async function deletePickQueued(uuid: string): Promise<void> {
  const db = await getDb();
  await db.delete('pick_queue', uuid);
}
