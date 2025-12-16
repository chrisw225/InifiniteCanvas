import { ViewportState, TILE_SIZE, TileCoord, getTileKey, Layer } from "@/types/shared";

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

    constructor(device: GPUDevice) {
        this.device = device;
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
            if (!layer.visible) continue;

            for (let tx = loadMinTx; tx <= loadMaxTx; tx++) {
                for (let ty = loadMinTy; ty <= loadMaxTy; ty++) {
                    const key = getTileKey(layer.id, tx, ty);
                    let tile = this.tiles.get(key);

                    if (!tile) {
                        // New tile, start loading
                        tile = {
                            texture: null,
                            status: 'loading',
                            lastUsedTimestamp: now
                        };
                        this.tiles.set(key, tile);
                        this.loadTileData(layer.id, tx, ty);
                    } else {
                        tile.lastUsedTimestamp = now;
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
            // Mock fetch - in real app, fetch from API
            // const response = await fetch(`/api/tile/${layerId}/${tx}/${ty}`);
            // For now, create a blank texture

            // Simulate network delay
            // await new Promise(resolve => setTimeout(resolve, 100));

            // Create GPU Texture
            const texture = this.device.createTexture({
                size: [TILE_SIZE, TILE_SIZE],
                format: navigator.gpu.getPreferredCanvasFormat(), // Match swap chain for simplicity in MVP
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            });

            // Clear to transparent (or debug color)
            // We will leave it empty for now, relying on render pass loadOp 'clear' if we were rendering TO it. 
            // But since we are rendering IT, we need content.
            // Let's create a checkerboard pattern for debug if it's the background layer.

            if (layerId === 'layer-0') {
                this.writeDebugPattern(texture, tx, ty);
            } else {
                this.clearTexture(texture);
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

    public getVisibleTiles(): { key: string, texture: GPUTexture, tx: number, ty: number, layerId: string }[] {
        const result = [];
        for (const [key, tile] of this.tiles.entries()) {
            if (tile.status === 'ready' && tile.texture) {
                const parts = key.split(':');
                result.push({
                    key,
                    texture: tile.texture,
                    layerId: parts[0],
                    tx: parseInt(parts[1]),
                    ty: parseInt(parts[2])
                });
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
        }
        return null;
    }
}
