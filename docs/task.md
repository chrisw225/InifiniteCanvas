# TileDraw MVP Task List

- [x] **Project Initialization**
    - [x] Initialize Next.js project <!-- id: 0 -->
    - [x] Configure TypeScript and CSS (Vanilla/CSS Modules) <!-- id: 1 -->

- [x] **Core Architecture & WebGPU Setup**
    - [x] Initialize WebGPU Device and Context <!-- id: 2 -->
    - [x] Create shared types for Coordinates, TileData, and BrushSettings <!-- id: 3 -->
    - [x] Implement Viewport/Camera state (x, y, zoom) <!-- id: 4 -->

- [x] **Tiling Engine (The "Anti-Gravity" Architecture)**
    - [x] Implement `TileManager` to calculate visible tiles based on Viewport <!-- id: 5 -->
    - [x] Create Tile Data Structure (Sparse Map) <!-- id: 6 -->
    - [x] Implement Tile Loading/Unloading logic (2x buffer zone) <!-- id: 7 -->
    - [ ] Implement Mock API for Tile I/O (`/api/tile/...`) <!-- id: 8 -->

- [x] **Rendering Engine**
    - [x] Create WebGPU Render Pipeline for Tile Grid <!-- id: 9 -->
    - [x] Implement Layer Composition (3 layers: Background, Line, Color) <!-- id: 10 -->
    - [x] specific shader for rendering tiles with opacity <!-- id: 11 -->

- [x] **Interaction & Drawing**
    - [x] Implement Canvas Input Handler (PointerEvents) <!-- id: 12 -->
    - [x] Implement Pan/Zoom logic (Mouse Wheel / Drag) <!-- id: 13 -->
    - [x] Implement Brush Tool (WebGPU Compute/Render to texture) <!-- id: 14 -->
    - [x] Implement Tablet Pressure Support (Internal logic + touch-action) <!-- id: 15 -->
    - [x] Implement Eraser Tool (Pipeline + Shorts B/E) <!-- id: 16 -->

- [ ] **User Interface**
    - [ ] Create Tool Panel (Brush, Eraser, Color Picker) <!-- id: 17 -->
    - [ ] Create Layer Panel (Toggle Visibility) <!-- id: 18 -->
    - [ ] Integrate Color Picker <!-- id: 19 -->

- [ ] **Verification**
    - [ ] Verify Infinite Panning <!-- id: 20 -->
    - [ ] Verify Drawing persistence across tiles <!-- id: 21 -->
    - [ ] Verify Pressure Sensitivity <!-- id: 22 -->
