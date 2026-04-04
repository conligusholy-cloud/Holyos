import { WorkProcedureProduct } from '../../../shared/types.js';
interface StageItem {
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
    products: WorkProcedureProduct[];
    allItems: WorkProcedureProduct[];
    stages: StageItem[];
    parseEnv(text: string): Record<string, string>;
    loadEnv(): Promise<boolean>;
    fetchAPI(path: string, options?: {
        method?: string;
        body?: unknown;
    }): Promise<unknown>;
    queryEntity(entityName: string, filter?: unknown): Promise<unknown>;
    extractArray(data: unknown): unknown[];
    loadProducts(): Promise<WorkProcedureProduct[]>;
    loadStages(): Promise<StageItem[]>;
};
export {};
