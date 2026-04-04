import type { ObjectType, EntranceType, Dimensions } from '../../../shared/types.js';
export interface ColorConfig {
    fill: string;
    stroke: string;
    label: string;
}
export interface EntranceTypeConfig {
    color: string;
    label: string;
    icon: string;
}
export declare const COLORS: Record<ObjectType, ColorConfig>;
export declare const DEFAULT_SIZES: Record<ObjectType, Dimensions>;
export declare const POLYGON_TYPES: ObjectType[];
export declare const RECT_TYPES: ObjectType[];
export declare const COLOR_SWATCHES: string[];
export declare const ENTRANCE_TYPES: Record<EntranceType, EntranceTypeConfig>;
