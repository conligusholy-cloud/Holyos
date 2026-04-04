import { Product, RouteOperation } from '../../../shared/types.js';
import { showToast } from './app.js';
export { showToast };
interface Stage {
    id: string;
    name: string;
    code: string;
    raw: unknown;
}
interface FactorifyConfig {
    baseUrl: string;
    proxyUrl: string;
    useProxy: boolean;
    securityToken: string;
    headers: Record<string, string>;
}
export declare const FactorifyAPI: {
    connected: boolean;
    loading: boolean;
    error: string | null;
    configLoaded: boolean;
    config: FactorifyConfig;
    products: Product[];
    stages: Stage[];
    routes: Record<string, RouteOperation[]>;
    entities: unknown[];
    parseEnv(text: string): Record<string, string>;
    loadEnv(): Promise<boolean>;
    fetchAPI(path: string, options?: {
        method?: string;
        body?: unknown;
    }): Promise<unknown>;
    queryEntity(entityName: string, filter?: unknown): Promise<unknown>;
    extractArray(data: unknown): unknown[];
    loadEntities(): Promise<unknown[]>;
    loadProducts(): Promise<Product[]>;
    loadStages(): Promise<Stage[]>;
    loadRoute(itemId: string): Promise<RouteOperation[]>;
};
export declare function openProductDialog(): void;
export declare function closeProductDialog(): void;
export declare function filterProducts(query: string): void;
export declare function selectProduct(productId: string | number): Promise<void>;
export declare function renderRouteInfo(): void;
export declare function mapRouteToFloorPlan(): void;
export declare function openManualRouteEditor(): void;
export declare function applyManualRoute(): void;
export declare function openConfigDialog(): void;
export declare function closeConfigDialog(): void;
export declare function applyConfig(): void;
export declare function getAllProgramming(): any[];
export declare function getAllAreals(): any[];
export declare function loadProgramming(progId: string): boolean;
export declare function formatDuration(seconds: number): string;
