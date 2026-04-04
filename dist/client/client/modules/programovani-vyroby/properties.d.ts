export declare function showProperties(id: number): void;
export declare function getRotateCenter(): number;
export declare function updateVertex(objId: number, index: number, axis: 'x' | 'y', value: number): void;
export declare function updateEdgeDistance(objId: number, fromIndex: number, newDist: number): void;
export declare function removeVertex(objId: number, index: number): void;
export declare function updateGateProp(objId: number, wallId: number, gateId: number, key: string, value: any): void;
export declare function toggleLock(objId: number): void;
export declare function deselectAll(): void;
export declare function updateTitleBar(): void;
