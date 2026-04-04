interface PersistentStorageInterface {
    getItem(key: string): Promise<string>;
    getItemSync(key: string): string | null;
    setItem(key: string, data: string | Record<string, unknown> | any[]): Promise<boolean>;
    init(keys: string | string[]): Promise<void>;
    migrateFromLocalStorage(keys: string | string[]): Promise<string[]>;
    isServerAvailable(): boolean | null;
}
export declare const PersistentStorage: PersistentStorageInterface;
export {};
