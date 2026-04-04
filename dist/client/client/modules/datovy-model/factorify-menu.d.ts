export interface MenuItem {
    label: string;
    slug: string;
    entityName: string;
}
export interface MenuCategory {
    name: string;
    items: MenuItem[];
}
export declare const TOP_ITEMS: MenuItem[];
export declare const MENU: MenuCategory[];
export declare function buildEntityResolver(apiEntities: {
    name: string;
    endpointUrl: string;
    label: string;
}[]): Map<string, string>;
