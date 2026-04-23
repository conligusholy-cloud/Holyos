// HolyOS PWA — repo pro katalog (materials + locations) v IndexedDB.
import { getDb, type CachedLocation, type CachedMaterial } from './schema';

export async function upsertMaterials(items: CachedMaterial[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDb();
  const tx = db.transaction('materials', 'readwrite');
  await Promise.all(items.map((item) => tx.store.put(item)));
  await tx.done;
}

export async function upsertLocations(items: CachedLocation[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDb();
  const tx = db.transaction('locations', 'readwrite');
  await Promise.all(items.map((item) => tx.store.put(item)));
  await tx.done;
}

export async function countMaterials(): Promise<number> {
  const db = await getDb();
  return db.count('materials');
}

export async function countLocations(): Promise<number> {
  const db = await getDb();
  return db.count('locations');
}

export async function findMaterialByBarcode(barcode: string): Promise<CachedMaterial | null> {
  if (!barcode) return null;
  const db = await getDb();
  const match = await db.getFromIndex('materials', 'by-barcode', barcode);
  return match ?? null;
}

export async function findLocationByBarcode(barcode: string): Promise<CachedLocation | null> {
  if (!barcode) return null;
  const db = await getDb();
  const match = await db.getFromIndex('locations', 'by-barcode', barcode);
  return match ?? null;
}

export async function getMaterial(id: number): Promise<CachedMaterial | null> {
  const db = await getDb();
  return (await db.get('materials', id)) ?? null;
}

export async function getLocation(id: number): Promise<CachedLocation | null> {
  const db = await getDb();
  return (await db.get('locations', id)) ?? null;
}

export async function clearCatalog(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['materials', 'locations'], 'readwrite');
  await Promise.all([tx.objectStore('materials').clear(), tx.objectStore('locations').clear()]);
  await tx.done;
}
