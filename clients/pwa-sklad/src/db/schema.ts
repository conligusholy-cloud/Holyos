// HolyOS PWA — IndexedDB schéma (v1)
//
// Stores:
//   - materials      :: key = id (number), index "by-barcode" (unique-ish, ale
//                       schema backendu barcode @unique jen validuje, v IDB
//                       řešíme idempotentně přes put)
//   - locations      :: key = id, index "by-barcode"
//   - write_queue    :: key = client_uuid, index "by-status", "by-created-at"
//   - meta           :: key/value store pro last_sync timestamps, device_id, apod.

import type { DBSchema, IDBPDatabase } from 'idb';
import { openDB } from 'idb';

export const DB_NAME = 'holyos-pwa-sklad';
export const DB_VERSION = 2;

// ---------- typy záznamů ---------------------------------------------------

export interface CachedMaterial {
  id: number;
  code: string;
  name: string;
  barcode: string | null;
  unit: string | null;
  sector: string | null;
  current_stock: number;
  min_stock: number | null;
  updated_at: string; // ISO
}

export interface CachedLocation {
  id: number;
  warehouse_id: number;
  label: string;
  barcode: string | null;
  type: string | null;
  section: string | null;
  rack: string | null;
  position: string | null;
  locked_for_inventory: boolean;
  [key: string]: unknown; // backend vrací celý objekt, schema se může rozšířit
}

export type QueueStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface QueuedMove {
  client_uuid: string;
  type: string; // moves.service MOVE_TYPES
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

  // klient-side metadata
  status: QueueStatus;
  created_at: string;        // ISO — kdy byl vytvořen v PWA
  attempts: number;
  last_error?: string | null;
  last_attempt_at?: string | null;
  synced_at?: string | null;
  server_move_id?: number | null;
  deduped?: boolean;
}

// Queued inventura — PUT /api/wh/inventories/:invId/items/:itemId { actual_qty }
// Idempotentní: stejný PUT dá stejný výsledek, takže není třeba client_uuid na
// backendu. Klient si drží uuid jako primary key jen pro identifikaci záznamu.
export interface QueuedInventoryCount {
  client_uuid: string;
  inventory_id: number;
  item_id: number;
  actual_qty: number;

  status: QueueStatus;
  created_at: string;
  attempts: number;
  last_error?: string | null;
  last_attempt_at?: string | null;
  synced_at?: string | null;
}

// Queued pick — POST /api/wh/batches/:id/pick s {batch_item_id, picked_quantity,
// from_location_id, client_uuid}. Backend používá client_uuid pro idempotenci
// sekundárního inventory_movement (issue), takže resend je bezpečný.
export interface QueuedPick {
  client_uuid: string;
  batch_id: number;
  batch_item_id: number;
  picked_quantity: number;
  from_location_id?: number | null;
  note?: string | null;

  status: QueueStatus;
  created_at: string;
  attempts: number;
  last_error?: string | null;
  last_attempt_at?: string | null;
  synced_at?: string | null;
}

export type MetaKey =
  | 'last_materials_sync'
  | 'last_locations_sync'
  | 'device_id';

export interface MetaRecord {
  key: MetaKey;
  value: string;
  updated_at: string;
}

// ---------- IDB schema ------------------------------------------------------

export interface HolyDb extends DBSchema {
  materials: {
    key: number;
    value: CachedMaterial;
    indexes: { 'by-barcode': string };
  };
  locations: {
    key: number;
    value: CachedLocation;
    indexes: { 'by-barcode': string };
  };
  write_queue: {
    key: string;
    value: QueuedMove;
    indexes: {
      'by-status': QueueStatus;
      'by-created-at': string;
    };
  };
  inventory_queue: {
    key: string;
    value: QueuedInventoryCount;
    indexes: {
      'by-status': QueueStatus;
      'by-created-at': string;
    };
  };
  pick_queue: {
    key: string;
    value: QueuedPick;
    indexes: {
      'by-status': QueueStatus;
      'by-created-at': string;
    };
  };
  meta: {
    key: MetaKey;
    value: MetaRecord;
  };
}

// ---------- singleton ------------------------------------------------------

let dbPromise: Promise<IDBPDatabase<HolyDb>> | null = null;

export function getDb(): Promise<IDBPDatabase<HolyDb>> {
  if (!dbPromise) {
    dbPromise = openDB<HolyDb>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const materials = db.createObjectStore('materials', { keyPath: 'id' });
          materials.createIndex('by-barcode', 'barcode', { unique: false });

          const locations = db.createObjectStore('locations', { keyPath: 'id' });
          locations.createIndex('by-barcode', 'barcode', { unique: false });

          const queue = db.createObjectStore('write_queue', { keyPath: 'client_uuid' });
          queue.createIndex('by-status', 'status', { unique: false });
          queue.createIndex('by-created-at', 'created_at', { unique: false });

          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (oldVersion < 2) {
          const invQ = db.createObjectStore('inventory_queue', { keyPath: 'client_uuid' });
          invQ.createIndex('by-status', 'status', { unique: false });
          invQ.createIndex('by-created-at', 'created_at', { unique: false });

          const pickQ = db.createObjectStore('pick_queue', { keyPath: 'client_uuid' });
          pickQ.createIndex('by-status', 'status', { unique: false });
          pickQ.createIndex('by-created-at', 'created_at', { unique: false });
        }
      },
      blocked() {
        // jiný tab drží starší verzi — dočasně ignorujeme
        console.warn('[holyos-pwa] IndexedDB upgrade blocked by another tab');
      },
      terminated() {
        // DB disconnect (browser kvůli paměti apod.) — nech otevřít znova
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}
