# TileDraw MVP Implementation Plan

## Goal Description
Build "TileDraw", a WebGPU-based infinite canvas raster editor.
**Core capability**: Sparse tile mapping ($256 \times 256$ chunks) enabling infinite panning and zooming with performant memory management.
**MVP Scope**: 3 Layers, Basic Brush/Eraser, Tablet Pressure, Hex Color Picker.

## User Review Required
> [!IMPORTANT]
> **WebGPU Requirement**: This project strictly requires a browser with WebGPU support (Chrome 113+, Edge 113+, etc.). The application will crash or show an error on unsupported browsers.

> [!NOTE]
> **Styling**: Using CSS Modules (Vanilla CSS) as requested by system prompt preference, avoiding Tailwind unless requested.

## Proposed Changes

### Project Structure (New Next.js App)
- `src/app`: App Router pages.
- `src/components`: UI Components (Toolbar, LayerPanel).
- `src/engine`: Core logic (non-React).
    - `CanvasManager.ts`: Main entry point for the graphics engine.
    - `TileManager.ts`: Handles sparse map, loading/unloading logic.
    - `Renderer.ts`: WebGPU render passes.
    - `InputHandler.ts`: Raw pointer event processing.
- `src/types`: Shared interfaces.

### 1. Project Setup
- Initialize Next.js with TypeScript and ESLint.
- Configure clean CSS baseline.

### 2. Tiling Architecture
**Coordinate Systems**:
- **World Space**: Float $(x, y)$ representing infinite pixel space.
- **Tile Space**: Integer $(tx, ty)$ where $tx = \lfloor x / 256 \rfloor$.
- **Screen Space**: Viewport pixel coordinates.

**TileManager**:
- Keeps a `Map<string, GPUTexture>` where key is `layerId:x:y`.
- **Render Loop**:
    1. Calculate visible tile range $[x_{min}, x_{max}, y_{min}, y_{max}]$.
    2. Request needed tiles from `TileStore`.
    3. Prune tiles outside buffer zone (Viewport $\times 2$).

### 3. WebGPU Rendering
- **Shared `GPUDevice`**.
- **Quad Rendering**: Instanced rendering or individual draw calls for each visible tile.
- **Compositing**: Render Layer 0 (Bottom) -> Layer 1 -> Layer 2 with alpha blending.

### 4. Drawing Logic
- **Stroke System**:
    - Capture `pointermove` events (with `pressure`).
    - Interpolate points (Basic Bresenham or quadratic curve if time permits, but MVP specifies simple round brush).
    - Update the specific `GPUTexture` for the tile under the cursor.
    - *Complexity*: A stroke might cross tile boundaries. The `Brush` system needs to identify which tile(s) to draw onto.

### 5. Backend (Mock)
- `GET /api/tile/[layer]/[x]/[y]`: Returns binary pixel data or empty 404.
- `POST /api/tile/[layer]/[x]/[y]`: Saves pixel data.
- **Storage**: In-memory `Map` on the server (simulated persistence during session) or local filesystem if running locally.

## Verification Plan

### Automated Tests
- N/A for WebGPU visual output (difficult to snapshot test in this environment without headless WebGPU).
- Unit tests for `Coordinate` conversion logic (World <-> Tile).

### Manual Verification
1. **Load App**: Ensure Grid renders.
2. **Infinite Navigation**: Pan continuously in one direction. Monitor memory/network network tab to see tiles loading/unloading.
3. **Drawing**: Draw a circle crossing 4 tiles (vertex of the grid). Check if continuity exists.
4. **Layers**: Draw Red on Layer 0, Blue on Layer 1. Toggle Layer 1 visibility.
5. **Pressure**: Use a tablet/simulated pressure to vary line width.
