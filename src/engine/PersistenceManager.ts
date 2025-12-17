import { Layer } from "@/types/shared";

export class PersistenceManager {
    private dbName = "TileDrawDB";
    private storeName = "tiles";
    private dbVersion = 1;
    private db: IDBDatabase | null = null;

    constructor() {
        this.initDB();
    }

    private initDB(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = (event) => {
                console.error("IndexedDB error:", event);
                reject("IndexedDB failed to open");
            };

            request.onsuccess = (event) => {
                this.db = (event.target as IDBOpenDBRequest).result;
                console.log("IndexedDB opened successfully");
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName); // Key is the tile key string
                }
            };
        });
    }

    // --- Layer Persistence (LocalStorage) ---

    public saveLayers(layers: Layer[]) {
        try {
            localStorage.setItem("tiledraw_layers", JSON.stringify(layers));
        } catch (e) {
            console.error("Failed to save layers to LocalStorage", e);
        }
    }

    public loadLayers(): Layer[] | null {
        try {
            const data = localStorage.getItem("tiledraw_layers");
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.error("Failed to load layers from LocalStorage", e);
            return null;
        }
    }

    // --- Tile Persistence (IndexedDB) ---

    public async deleteTile(key: string) {
        if (!this.db) await this.initDB();
        if (!this.db) return;

        return new Promise<void>((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], "readwrite");
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    public async saveTile(key: string, blob: Blob) {
        if (!this.db) await this.initDB();
        if (!this.db) return;

        return new Promise<void>((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], "readwrite");
            const store = transaction.objectStore(this.storeName);
            const request = store.put(blob, key);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    public async loadTile(key: string): Promise<Blob | null> {
        if (!this.db) await this.initDB();
        if (!this.db) return null;

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([this.storeName], "readonly");
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);

            request.onsuccess = () => {
                resolve(request.result as Blob || null);
            };
            request.onerror = () => {
                // Not found is not an error effectively, but request error logic usually fires for internal errors
                resolve(null);
            };
        });
    }

    public async clearAll() {
        if (!this.db) await this.initDB();
        localStorage.removeItem("tiledraw_layers");

        if (this.db) {
            const transaction = this.db.transaction([this.storeName], "readwrite");
            const store = transaction.objectStore(this.storeName);
            store.clear();
        }
    }
}
