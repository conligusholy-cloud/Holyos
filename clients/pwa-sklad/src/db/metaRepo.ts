// HolyOS PWA — meta key/value repo (last_sync, device_id, ...)
import { getDb, type MetaKey } from './schema';

export async function getMeta(key: MetaKey): Promise<string | null> {
  const db = await getDb();
  const record = await db.get('meta', key);
  return record?.value ?? null;
}

export async function setMeta(key: MetaKey, value: string): Promise<void> {
  const db = await getDb();
  await db.put('meta', { key, value, updated_at: new Date().toISOString() });
}

export async function getAllMeta(): Promise<Record<string, string>> {
  const db = await getDb();
  const all = await db.getAll('meta');
  return Object.fromEntries(all.map((row) => [row.key, row.value]));
}
