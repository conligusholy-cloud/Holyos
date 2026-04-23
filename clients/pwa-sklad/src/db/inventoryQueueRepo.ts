// HolyOS PWA — queue pro inventární počty (offline safe)
import { getDb, type QueuedInventoryCount, type QueueStatus } from './schema';

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  const rnd = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${rnd()}${rnd()}-${rnd()}-4${rnd().slice(1)}-${rnd()}-${rnd()}${rnd()}${rnd()}`;
}

export interface NewInventoryCount {
  inventory_id: number;
  item_id: number;
  actual_qty: number;
}

export async function enqueueInventoryCount(input: NewInventoryCount): Promise<QueuedInventoryCount> {
  const db = await getDb();
  const record: QueuedInventoryCount = {
    client_uuid: generateUuid(),
    ...input,
    status: 'pending',
    created_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
    last_attempt_at: null,
    synced_at: null,
  };
  await db.put('inventory_queue', record);
  return record;
}

export async function listInventoryByStatus(status: QueueStatus): Promise<QueuedInventoryCount[]> {
  const db = await getDb();
  return db.getAllFromIndex('inventory_queue', 'by-status', status);
}

export async function listInventoryPending(): Promise<QueuedInventoryCount[]> {
  const items = await listInventoryByStatus('pending');
  return items.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function countInventoryByStatus(status: QueueStatus): Promise<number> {
  const db = await getDb();
  return db.countFromIndex('inventory_queue', 'by-status', status);
}

interface InventoryPatch {
  status?: QueueStatus;
  last_error?: string | null;
  attempts?: number;
  last_attempt_at?: string | null;
  synced_at?: string | null;
}

export async function patchInventory(client_uuid: string, patch: InventoryPatch): Promise<QueuedInventoryCount | null> {
  const db = await getDb();
  const tx = db.transaction('inventory_queue', 'readwrite');
  const current = await tx.store.get(client_uuid);
  if (!current) {
    await tx.done;
    return null;
  }
  const next: QueuedInventoryCount = { ...current, ...patch };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function markInventorySyncing(uuid: string) {
  return patchInventory(uuid, { status: 'syncing', last_attempt_at: new Date().toISOString() });
}
export async function markInventorySynced(uuid: string) {
  return patchInventory(uuid, { status: 'synced', synced_at: new Date().toISOString(), last_error: null });
}
export async function markInventoryFailed(uuid: string, err: string) {
  const db = await getDb();
  const current = await db.get('inventory_queue', uuid);
  return patchInventory(uuid, {
    status: 'failed',
    last_error: err,
    attempts: (current?.attempts ?? 0) + 1,
  });
}
export async function revertInventoryToPending(uuid: string, err?: string | null) {
  const db = await getDb();
  const current = await db.get('inventory_queue', uuid);
  return patchInventory(uuid, {
    status: 'pending',
    last_error: err ?? null,
    attempts: (current?.attempts ?? 0) + 1,
  });
}

export async function deleteInventoryQueued(uuid: string): Promise<void> {
  const db = await getDb();
  await db.delete('inventory_queue', uuid);
}
