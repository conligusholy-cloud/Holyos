import type { Dimensions, ObjectType } from '../../../shared/types.js';
export interface ColorConfig {
    fill: string;
    stroke: string;
    label: string;
}
export interface ColorScheme {
    areal: ColorConfig;
    hala: ColorConfig;
    pracoviste: ColorConfig;
    sklad: ColorConfig;
    cesta: ColorConfig;
    vstup: ColorConfig;
}
export interface EntranceTypeConfig {
    color: string;
    label: string;
    icon: string;
}
export interface EntranceTypesConfig {
    vjezd: EntranceTypeConfig;
    vyjezd: EntranceTypeConfig;
    oboji: EntranceTypeConfig;
}
export interface DefaultSizesConfig {
    areal: Dimensions;
    hala: Dimensions;
    pracoviste: Dimensions;
    sklad: Dimensions;
    cesta: Dimensions;
    vstup: Dimensions;
}
export declare const COLORS: ColorScheme;
export declare const DEFAULT_SIZES: DefaultSizesConfig;
export declare const POLYGON_TYPES: ObjectType[];
export declare const RECT_TYPES: ObjectType[];
export declare const COLOR_SWATCHES: string[];
export declare const ENTRANCE_TYPES: EntranceTypesConfig;
