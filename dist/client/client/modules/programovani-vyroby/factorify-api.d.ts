import type { FactorifyWorkstation, WorkstationConfig } from '../../../shared/types.js';
export interface FactorifyConfig {
    baseUrl: string;
    proxyUrl: string;
    useProxy: boolean;
    securityToken: string;
    workstationEntity: string;
    endpoints: {
        entities: string;
        entityMeta: string;
        query: string;
    };
    headers: Record<string, string>;
}
export declare const FactorifyAPI: {
    connected: boolean;
    workstations: FactorifyWorkstation[];
    entities: any[];
    loading: boolean;
    error: string | null;
    configLoaded: boolean;
    config: FactorifyConfig;
    parseEnv(text: string): Record<string, string>;
    loadEnv(): Promise<boolean>;
    getConfig(): FactorifyConfig;
    getHeaders(): Record<string, string>;
    fetchAPI(path: string, options?: any): Promise<any>;
    loadEntities(): Promise<any[]>;
    loadEntityMeta(entityName: string): Promise<any>;
    queryEntity(entityName: string, filter?: any): Promise<any>;
    loadWorkstations(): Promise<FactorifyWorkstation[]>;
    findWorkstationEntity(): Promise<any[]>;
};
export declare function getWsDimensions(wsId: string): WorkstationConfig;
export declare function setWsDimension(wsId: string, axis: 'w' | 'h', value: string): void;
export declare function applyDefaultSize(w?: number, h?: number): void;
export declare function getUsedWsIds(): Set<string>;
export declare function markUsedWorkstations(): void;
export declare function renderWsPreview(container: HTMLElement, wMeters: number, hMeters: number): void;
export declare function updateFactorifyUI(): void;
export declare function filterWorkstationList(query: string): void;
export declare function dragWorkstation(e: DragEvent, wsId: string): void;
export declare function openWsConfigDialog(): void;
export declare function closeWsConfigDialog(): void;
export declare function saveWsConfig(): void;
export declare function wsConfigApplyDefaults(): void;
export declare function wsConfigToggleAll(checked: boolean): void;
