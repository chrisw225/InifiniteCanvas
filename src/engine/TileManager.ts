import { ViewportState, TILE_SIZE, TileCoord, getTileKey, Layer } from "@/types/shared";
import { PersistenceManager } from "./PersistenceManager";

interface TileState {
    texture: GPUTexture | null;
    status: 'loading' | 'ready' | 'error';
    lastUsedTimestamp: number;
}

export class TileManager {
    private device: GPUDevice;
    // Map key: "layerId:tx:ty" -> TileState
    private tiles: Map<string, TileState> = new Map();
    // Buffer factor: 2 means load tiles within 2x viewport size
    private readonly BUFFER_FACTOR = 1.0;
    private persistenceManager: PersistenceManager;

    constructor(device: GPUDevice) {
        this.device = device;
        this.persistenceManager = new PersistenceManager();
    }

    public update(viewport: ViewportState, layers: Layer[]) {
        // 1. Calculate visible tile range
        // Viewport x,y is center. 
        const halfWidth = viewport.width / 2 / viewport.zoom;
        const halfHeight = viewport.height / 2 / viewport.zoom;

        const minX = viewport.x - halfWidth;
        const maxX = viewport.x + halfWidth;
        const minY = viewport.y - halfHeight;
        const maxY = viewport.y + halfHeight;

        const minTx = Math.floor(minX / TILE_SIZE);
        const maxTx = Math.floor(maxX / TILE_SIZE);
        const minTy = Math.floor(minY / TILE_SIZE);
        const maxTy = Math.floor(maxY / TILE_SIZE);

        // Buffer range (load slightly outside visible area)
        const bufferTx = 2; // Extra tiles
        const bufferTy = 2;

        const loadMinTx = minTx - bufferTx;
        const loadMaxTx = maxTx + bufferTx;
        const loadMinTy = minTy - bufferTy;
        const loadMaxTy = maxTy + bufferTy;

        const now = performance.now();

        // 2. Identify tiles to load
        for (const layer of layers) {
            // Note: We keep hidden tiles in memory (via timestamp update) to avoid data loss on hide.
            // But we only CREATE new tiles if visible (or if we decide to pre-load hidden ones, but simpler to wait).

            for (let tx = loadMinTx; tx <= loadMaxTx; tx++) {
                for (let ty = loadMinTy; ty <= loadMaxTy; ty++) {
                    const key = getTileKey(layer.id, tx, ty);
                    let tile = this.tiles.get(key);

                    if (tile) {
                        // Tile exists: Keep it alive via timestamp update
                        tile.lastUsedTimestamp = now;
                    } else if (layer.visible) {
                        // Tile missing AND layer visible: Load (Create) it
                        tile = {
                            texture: null,
                            status: 'loading',
                            lastUsedTimestamp: now
                        };
                        this.tiles.set(key, tile);
                        this.loadTileData(layer.id, tx, ty);
                    }
                }
            }
        }

        // 3. Prune old tiles
        this.prune(now);
    }

    private async loadTileData(layerId: string, tx: number, ty: number) {
        const key = getTileKey(layerId, tx, ty);

        try {
            // 1. Try Persistence
            const blob = await this.persistenceManager.loadTile(key);

            // Create GPU Texture
            const texture = this.device.createTexture({
                size: [TILE_SIZE, TILE_SIZE],
                format: navigator.gpu.getPreferredCanvasFormat(),
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
            });

            if (blob) {
                // 2. Load from Persistence
                const arrayBuffer = await blob.arrayBuffer();
                const data = new Uint8Array(arrayBuffer);

                this.device.queue.writeTexture(
                    { texture: texture },
                    data,
                    { bytesPerRow: TILE_SIZE * 4 },
                    { width: TILE_SIZE, height: TILE_SIZE }
                );
            } else {
                // 3. New Tile (Init logic)
                if (layerId === 'layer-0') {
                    this.writeDebugPattern(texture, tx, ty);
                } else {
                    this.clearTexture(texture);
                }
            }

            const tile = this.tiles.get(key);
            if (tile) {
                tile.texture = texture;
                tile.status = 'ready';
            }

        } catch (e) {
            console.error(`Failed to load tile ${key}`, e);
            const tile = this.tiles.get(key);
            if (tile) tile.status = 'error';
        }
    }

    public async saveTile(layerId: string, tx: number, ty: number) {
        const key = getTileKey(layerId, tx, ty);
        const tile = this.tiles.get(key);
        if (!tile || !tile.texture || tile.status !== 'ready') return;

        // Read texture back to CPU
        const pixelSize = 4; // RGBA8
        const bufferSize = TILE_SIZE * TILE_SIZE * pixelSize;

        // 1. Copy Texture to Buffer
        const buffer = this.device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });

        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.copyTextureToBuffer(
            { texture: tile.texture },
            { buffer: buffer, bytesPerRow: TILE_SIZE * pixelSize },
            { width: TILE_SIZE, height: TILE_SIZE }
        );
        this.device.queue.submit([commandEncoder.finish()]);

        // 2. Map Buffer
        await buffer.mapAsync(GPUMapMode.READ);
        const arrayBuffer = buffer.getMappedRange().slice(0); // Copy
        buffer.unmap();

        // 3. Create Blob (Simple Raw Data or PNG?)
        // IndexedDB handles Blobs well. But raw RGBA data isn't an image format browsers display natively.
        // Ideally we save as PNG for easier debugging/portability, but raw binary is faster.
        // Let's stick to raw binary for speed, OR convert to PNG via Canvas (slower).
        // Plan: Save ArrayBuffer directly. On load, we use copyTextureToBuffer? No copyExternalImageToTexture takes ImageBitmap.
        // If we supply ArrayBuffer, we must use device.queue.writeTexture.

        // Let's verify load logic: I used `copyExternalImageToTexture` inside `loadTileData`, which expects ImageBitmap.
        // If I save raw ArrayBuffer, I should use `this.device.queue.writeTexture` instead. 
        // Let's refactor `loadTileData` to inspect the blob type or just try both.
        // Actually, easiest MVP: Save as ArrayBuffer, Load using writeTexture.

        const blob = new Blob([arrayBuffer]); // application/octet-stream
        await this.persistenceManager.saveTile(key, blob);
    }

    // ... (Private helpers below) ...

    private writeDebugPattern(texture: GPUTexture, tx: number, ty: number) {
        // Create a generic buffer to upload 
        const pixelSize = 4; // RGBA8
        const data = new Uint8Array(TILE_SIZE * TILE_SIZE * pixelSize);

        // Simple grid pattern
        for (let y = 0; y < TILE_SIZE; y++) {
            for (let x = 0; x < TILE_SIZE; x++) {
                const i = (y * TILE_SIZE + x) * pixelSize;

                // Debug Grid borders
                const isBorder = x === 0 || y === 0 || x === TILE_SIZE - 1 || y === TILE_SIZE - 1;

                if (isBorder) {
                    data[i] = 200; // R
                    data[i + 1] = 200; // G
                    data[i + 2] = 200; // B
                    data[i + 3] = 255; // A
                } else if ((Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 0) {
                    // Checkerboard
                    data[i] = 240;
                    data[i + 1] = 240;
                    data[i + 2] = 240;
                    data[i + 3] = 255;
                } else {
                    data[i] = 255;
                    data[i + 1] = 255;
                    data[i + 2] = 255;
                    data[i + 3] = 255;
                }
            }
        }

        this.device.queue.writeTexture(
            { texture },
            data,
            { bytesPerRow: TILE_SIZE * 4 },
            { width: TILE_SIZE, height: TILE_SIZE }
        );
    }

    private clearTexture(texture: GPUTexture) {
        const pixelSize = 4;
        const data = new Uint8Array(TILE_SIZE * TILE_SIZE * pixelSize); // All zeros = transparent
        this.device.queue.writeTexture(
            { texture },
            data,
            { bytesPerRow: TILE_SIZE * 4 },
            { width: TILE_SIZE, height: TILE_SIZE }
        );
    }


    private prune(now: number) {
        // Unload tiles not used in the last 2 seconds (simple LRU/Time-based)
        // In a real scrolling map, we'd check distance from viewport, but timestamp is a good proxy for "recently visible"
        // combined with the fact that we update timestamp every frame for visible tiles.
        const TIMEOUT = 2000;

        for (const [key, tile] of this.tiles.entries()) {
            if (now - tile.lastUsedTimestamp > TIMEOUT) {
                if (tile.texture) {
                    tile.texture.destroy();
                }
                this.tiles.delete(key);
            }
        }
    }

    public getVisibleTiles(layers: Layer[]): { key: string, texture: GPUTexture, tx: number, ty: number, layerId: string }[] {
        const visibleLayerIds = new Set(layers.filter(l => l.visible).map(l => l.id));
        const result = [];

        for (const [key, tile] of this.tiles.entries()) {
            if (tile.status === 'ready' && tile.texture) {
                const parts = key.split(':');
                const layerId = parts[0];

                if (visibleLayerIds.has(layerId)) {
                    result.push({
                        key,
                        texture: tile.texture,
                        layerId: layerId,
                        tx: parseInt(parts[1]),
                        ty: parseInt(parts[2])
                    });
                }
            }
        }
        return result;
    }

    public getTile(layerId: string, tx: number, ty: number): GPUTexture | null {
        const key = getTileKey(layerId, tx, ty);
        const tile = this.tiles.get(key);
        if (tile && tile.status === 'ready' && tile.texture) {
            return tile.texture;
        }
        // Proactive load? if we try to draw on a tile that isn't loaded, should we load it?
        // For MVP, if it's not loaded (not visible), maybe we ignore it or synchronous load is impossible.
        // We'll trigger load if missing, but return null for this frame.
        if (!tile) {
            // this.loadTileData(layerId, tx, ty); // Optional: trigger load
            // But we can't await it here.
        }
        return null;
    }

    // Helper to get PersistenceManager
    public getPersistence(): PersistenceManager {
        return this.persistenceManager;
    }
}
