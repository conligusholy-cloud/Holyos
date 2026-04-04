export interface EntityInfo {
    name: string;
    label: string;
    labelPlural: string;
    category: string;
    endpointUrl: string;
}
export interface EntityFieldMeta {
    name: string;
    label: string;
    mandatory: boolean;
    readOnly: boolean;
    hidden: boolean;
    position: number;
}
export interface QueryResult {
    rows: any[];
    totalCount: number;
}
export declare const CATEGORY_ORDER: {
    key: string;
    icon: string;
    color: string;
}[];
export declare const FactorifyBrowser: {
    entities: EntityInfo[];
    entityMap: Map<string, EntityInfo>;
    categories: Map<string, EntityInfo[]>;
    fieldCache: Map<string, EntityFieldMeta[]>;
    loading: boolean;
    error: string | null;
    fetchAPI(path: string, options?: {
        method?: string;
        body?: unknown;
    }): Promise<unknown>;
    loadEntities(): Promise<void>;
    loadFields(entityName: string): Promise<EntityFieldMeta[]>;
    queryRecords(entityName: string, options?: {
        offset?: number;
        limit?: number;
        orderBy?: string;
        orderDir?: string;
        search?: string;
    }): Promise<QueryResult>;
    getRecord(entityName: string, id: string | number): Promise<any>;
};
