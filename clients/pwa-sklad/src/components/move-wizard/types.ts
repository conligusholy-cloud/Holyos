// HolyOS PWA — typy pro MoveWizard.
import type { CachedLocation, CachedMaterial } from '../../db/schema';

export type StepId =
  | 'scan_material'
  | 'scan_from_location'
  | 'scan_to_location'
  | 'enter_quantity'
  | 'confirm';

export type MoveType = 'receipt' | 'issue' | 'transfer';

export interface WizardData {
  material?: CachedMaterial;
  fromLocation?: CachedLocation;
  toLocation?: CachedLocation;
  quantity?: number;
}
