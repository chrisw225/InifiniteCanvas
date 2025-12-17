import { ViewportState, TILE_SIZE, Layer } from "@/types/shared";
import { TileManager } from "./TileManager";

export class CanvasManager {
  private canvas: HTMLCanvasElement;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private animationFrameId: number | null = null;
  private tileManager: TileManager | null = null;

  private layers: Layer[] = [
    { id: 'layer-0', name: 'Background', visible: true, opacity: 1.0 },
    { id: 'layer-1', name: 'Drawing', visible: true, opacity: 1.0 },
    { id: 'layer-2', name: 'Overlay', visible: true, opacity: 1.0 },
  ];

  public viewport: ViewportState = {
    x: 0,
    y: 0,
    zoom: 1,
    width: 0,
    height: 0,
  };

  // Render Pipeline
  private pipeline: GPURenderPipeline | null = null;
  private sampler: GPUSampler | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroupParams: GPUBindGroup | null = null;

  // Input State
  private isSpacePressed = false;
  private isPanning = false;
  private lastPointerPos = { x: 0, y: 0 };


  // Brush Pipeline
  private activeTool: 'brush' | 'eraser' = 'brush';
  private brushColor: { r: number, g: number, b: number, a: number } = { r: 0, g: 0, b: 0, a: 1 };
  private brushSize: number = 50;

  private brushPipeline: GPURenderPipeline | null = null;
  private eraserPipeline: GPURenderPipeline | null = null;
  private brushUniformBuffer: GPUBuffer | null = null; // Brush params (color, size, etc.)
  private brushBindGroup: GPUBindGroup | null = null;

  // UI State Listeners
  private listeners: Set<() => void> = new Set();


  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async initialize() {
    if (!navigator.gpu) {
      throw new Error("WebGPU not supported on this browser.");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("No appropriate GPUAdapter found.");
    }

    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext("webgpu");

    if (!this.context) {
      throw new Error("Could not get WebGPU context.");
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: format,
      alphaMode: "premultiplied",
    });

    this.tileManager = new TileManager(this.device);

    // Load persisted layers
    const savedLayers = this.tileManager.getPersistence().loadLayers();
    if (savedLayers) {
      this.layers = savedLayers;
      // Ensure active layer exists
      if (!this.layers.find(l => l.id === this.activeLayerId)) {
        this.activeLayerId = this.layers[0]?.id || 'layer-0';
      }
    }

    await this.initPipeline(format);
    await this.initBrushPipeline(format);

    this.initInputHandlers();

    // Initial resize to set viewport dimensions
    this.resize();
    window.addEventListener("resize", this.onResize);

    this.startRenderLoop();
    console.log("CanvasManager initialized successfully");
  }


  private async initPipeline(format: GPUTextureFormat) {
    if (!this.device) return;

    const shaderModule = this.device.createShaderModule({
      code: `
            struct ViewportUniforms {
                screenSize: vec2f,
                cameraPos: vec2f,
                zoom: f32,
                flags: f32, // 1.0 = Show Grid
            };

            struct TileUniforms {
                pos: vec2f,
                scale: f32, 
                padding: f32,
            };

            @group(0) @binding(0) var<uniform> viewport : ViewportUniforms;
            @group(0) @binding(1) var mySampler : sampler;
            
            // Per-tile uniform
            @group(1) @binding(1) var<uniform> tile : TileUniforms; 

            struct VertexOutput {
                @builtin(position) Position : vec4f,
                @location(0) uv : vec2f,
            };

            @vertex
            fn vert_main(
                @builtin(vertex_index) VertexIndex : u32
            ) -> VertexOutput {
                var output : VertexOutput;
                
                var pos = array<vec2f, 6>(
                    vec2f(0.0, 0.0),
                    vec2f(1.0, 0.0),
                    vec2f(0.0, 1.0),
                    vec2f(0.0, 1.0),
                    vec2f(1.0, 0.0),
                    vec2f(1.0, 1.0)
                );

                let vPos = pos[VertexIndex];
                // Scale the tile quad based on LOD level
                let worldPos = tile.pos + (vPos * ${TILE_SIZE}.0 * tile.scale);
                
                let centered = (worldPos - viewport.cameraPos) * viewport.zoom;
                
                let normX = (centered.x) / (viewport.screenSize.x / 2.0);
                let normY = (centered.y) / (viewport.screenSize.y / 2.0) * -1.0; 

                output.Position = vec4f(normX, normY, 0.0, 1.0);
                output.uv = vPos; 

                return output;
            }

            @group(1) @binding(0) var myTexture : texture_2d<f32>;

            @fragment
            fn frag_main(@location(0) uv : vec2f) -> @location(0) vec4f {
                let color = textureSample(myTexture, mySampler, uv);
                
                // Debug Grid Overlay
                if (viewport.flags > 0.5) {
                    let borderWidth = 0.02; // relative to tile (0-1)
                    if (uv.x < borderWidth || uv.x > (1.0 - borderWidth) || 
                        uv.y < borderWidth || uv.y > (1.0 - borderWidth)) {
                        
                        // Color code by Level
                        // tile.scale = 2^level, so level = log2(tile.scale)
                        let level = log2(tile.scale);
                        
                        if (level < 0.5) { return vec4f(1.0, 0.0, 0.0, 1.0); } // Red = Level 0
                        else if (level < 1.5) { return vec4f(0.0, 1.0, 0.0, 1.0); } // Green = Level 1
                        else if (level < 2.5) { return vec4f(0.0, 0.0, 1.0, 1.0); } // Blue = Level 2
                        else { return vec4f(1.0, 1.0, 0.0, 1.0); } // Yellow = Level 3+
                    }
                }
                
                return color;
            }
          `
    });

    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroupLayout0 = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} }
      ]
    });

    this.bindGroupParams = this.device.createBindGroup({
      layout: bindGroupLayout0,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.sampler }
      ]
    });

    const bindGroupLayout1 = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} } // TilePos Uniform
      ]
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout0, bindGroupLayout1]
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vert_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'frag_main',
        targets: [{
          format: format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
          }
        }]
      },
      primitive: {
        topology: 'triangle-list',
      }
    });
  }

  private async initBrushPipeline(format: GPUTextureFormat) {
    if (!this.device) return;
    // Shader for Round Brush
    const shaderModule = this.device.createShaderModule({
      code: `
             struct BrushUniforms {
                 color: vec4f,
                 pos: vec2f, // Center of brush in LOCAL Tile coordinates (0-256)
                 size: f32,  // Radius
                 padding: f32, // align
             };
             
             @group(0) @binding(0) var<uniform> brush : BrushUniforms;
             
             struct VertexOutput {
                 @builtin(position) Position : vec4f,
                 @location(0) localPos : vec2f,
             };
             
             @vertex
             fn vert_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
                 var output : VertexOutput;
                 // Full Triangle covering the viewport (-1 to 1) 
                 // Actually we just render a Quad covering the tile? 
                 // Or better: Render a Quad covering the BRUSH area for optimization?
                 // For MVP: Render a full-tile Quad (2 triangles) and discard fragments outside circle. 
                 // Wait, we are rendering TO the TILE TEXTURE (256x256).
                 // So clip space (-1 to 1) maps to (0 to 256).
                 
                 var pos = array<vec2f, 6>(
                    vec2f(-1.0, -1.0),
                    vec2f( 1.0, -1.0),
                    vec2f(-1.0,  1.0),
                    vec2f(-1.0,  1.0),
                    vec2f( 1.0, -1.0),
                    vec2f( 1.0,  1.0)
                );
                
                let p = pos[VertexIndex];
                output.Position = vec4f(p, 0.0, 1.0);
                
                // Convert clip space (-1 to 1) to Local Tile Pixel Space (0 to 256)
                // x: -1 -> 0, 1 -> 256
                // x_pixel = (p.x + 1) * 0.5 * 256
                
                let x_pix = (p.x + 1.0) * 0.5 * ${TILE_SIZE}.0;
                // y: -1 is bottom? WebGPU clip Y is up? 
                // In render pass to texture, usually standard Y up? 
                // Let's assume (0,0) is top-left for TILE pixel coord logic.
                // Clip (-1, 1) -> Top Left (0,0) ??
                // WebGPU Clip: (-1, -1) = Bottom Left, (1, 1) = Top Right.
                // Texture Coord: (0, 0) = Top Left usually.
                // So Y needs flip.
                
                let y_pix = (1.0 - p.y) * 0.5 * ${TILE_SIZE}.0; // Flip Y
                
                output.localPos = vec2f(x_pix, y_pix);
                
                return output;
             }
             
             @fragment
             fn frag_main(@location(0) localPos : vec2f) -> @location(0) vec4f {
                 let dist = distance(localPos, brush.pos);
                 if (dist > brush.size) {
                     discard;
                 }
                 // Antialiasing?
                 // Simple hard edge for MVP
                 return brush.color;
             }
           `
    });

    this.brushUniformBuffer = this.device.createBuffer({
      size: 32, // vec4 + vec2 + f32 + pad = 16 + 8 + 4 + 4 = 32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const layout = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }]
    });

    this.brushBindGroup = this.device.createBindGroup({
      layout: layout,
      entries: [{ binding: 0, resource: { buffer: this.brushUniformBuffer } }]
    });

    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [layout] });

    // BRUSH PIPELINE (Additive/Normal Blend)
    this.brushPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: shaderModule, entryPoint: 'vert_main' },
      fragment: {
        module: shaderModule,
        entryPoint: 'frag_main',
        targets: [{
          format: format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
          }
        }]
      },
      primitive: { topology: 'triangle-list' }
    });

    // ERASER PIPELINE (Subtract/Clear)
    // To erase: Dst = Dst * (1 - BrushAlpha).
    // Standard blend: Src * SrcFactor + Dst * DstFactor
    // If Src (output of shader) is (0,0,0,1) [Black full alpha] or just used for factor control?
    // We want: R_out = R_in * (1 - Alpha_brush).
    // So: SrcFactor = Zero, DstFactor = OneMinusSrcAlpha.
    // Operation = Add.
    // Shader must output Alpha = 1 where we want to erase.

    this.eraserPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: shaderModule, entryPoint: 'vert_main' },
      fragment: {
        module: shaderModule,
        entryPoint: 'frag_main',
        targets: [{
          format: format,
          blend: {
            color: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' }
          }
        }]
      },
      primitive: { topology: 'triangle-list' }
    });
  }

  private screenToWorld(x: number, y: number): { x: number, y: number } {
    // Screen Center (cx, cy) corresponds to Viewport (vx, vy)
    // dx = (x - cx)
    // worldX = vx + dx / zoom

    const cx = this.viewport.width / 2;
    const cy = this.viewport.height / 2;

    const dx = x - cx;
    const dy = y - cy;

    return {
      x: this.viewport.x + dx / this.viewport.zoom,
      y: this.viewport.y + dy / this.viewport.zoom
    };
  }

  private initInputHandlers() {
    window.addEventListener('keydown', (e) => {
      // Tool Shortcuts
      if (e.key.toLowerCase() === 'b') {
        this.activeTool = 'brush';
        this.notifyListeners();
      }
      if (e.key.toLowerCase() === 'e') {
        this.activeTool = 'eraser';
        this.notifyListeners();
      }

      if (e.code === 'Space') {
        this.isSpacePressed = true;
        this.canvas.style.cursor = 'grab';
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.isSpacePressed = false;
        if (!this.isPanning) this.canvas.style.cursor = 'default';
      }
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomSensitivity = 0.001;
      const newZoom = this.viewport.zoom * (1 - e.deltaY * zoomSensitivity);
      this.viewport.zoom = Math.max(0.1, Math.min(newZoom, 10.0));
      this.notifyListeners();
      // Ideally zoom towards pointer, but keeping simple for now
    }, { passive: false });

    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);

      if (this.isSpacePressed || e.button === 1 || e.button === 2) {
        this.isPanning = true;
        this.lastPointerPos = { x: e.clientX, y: e.clientY };
        this.canvas.style.cursor = 'grabbing';
      } else if (e.buttons === 1) {
        // Start Drawing
        this.drawStroke(e.clientX, e.clientY, e.pressure);
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (this.isPanning) {
        const dx = e.clientX - this.lastPointerPos.x;
        const dy = e.clientY - this.lastPointerPos.y;

        // Move viewport opposite to drag
        this.viewport.x -= dx / this.viewport.zoom;
        this.viewport.y -= dy / this.viewport.zoom;

        this.lastPointerPos = { x: e.clientX, y: e.clientY };
      } else if (e.buttons === 1 && !this.isSpacePressed) {
        this.drawStroke(e.clientX, e.clientY, e.pressure);
      }
    });

    this.canvas.addEventListener('pointerup', (e) => {
      if (this.isPanning) {
        this.isPanning = false;
        this.canvas.style.cursor = this.isSpacePressed ? 'grab' : 'default';
      } else {
        // End of stroke -> Save Persistance
        this.saveDirtyTiles();
      }
      this.canvas.releasePointerCapture(e.pointerId);
    });
  }


  // Dirty tracking for save optimization
  private dirtyTiles: Set<string> = new Set();

  private saveDirtyTiles() {
    if (!this.tileManager) return;
    this.dirtyTiles.forEach(key => {
      const [layerId, tx, ty] = key.split(':');
      this.tileManager!.saveTile(layerId, parseInt(tx), parseInt(ty));
    });
    this.dirtyTiles.clear();
  }

  // override drawStroke to track dirty
  private drawStroke(screenX: number, screenY: number, pressure: number) {
    if (!this.tileManager || !this.device || !this.brushPipeline || !this.eraserPipeline || !this.brushBindGroup || !this.brushUniformBuffer) return;

    const world = this.screenToWorld(screenX, screenY);

    const brushSize = this.brushSize * pressure;
    // For Eraser: Color doesn't matter for RGB if srcFactor is zero, but Alpha matters for DstFactor (OneMinusSrcAlpha).
    // If we want full erase, Alpha = 1.0.
    const brushColor = this.brushColor;

    // Determine affected area in World Space
    const minX = world.x - brushSize;
    const maxX = world.x + brushSize;
    const minY = world.y - brushSize;
    const maxY = world.y + brushSize;

    // Determine range of tiles
    const minTx = Math.floor(minX / TILE_SIZE);
    const maxTx = Math.floor(maxX / TILE_SIZE);
    const minTy = Math.floor(minY / TILE_SIZE);
    const maxTy = Math.floor(maxY / TILE_SIZE);

    const commandEncoder = this.device.createCommandEncoder();
    let hasWork = false;

    const activePipeline = this.activeTool === 'eraser' ? this.eraserPipeline : this.brushPipeline;

    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let ty = minTy; ty <= maxTy; ty++) {
        const texture = this.tileManager.getTile(this.activeLayerId, tx, ty);
        if (!texture) continue;

        // TRACK DIRTY
        const key = `${this.activeLayerId}:${tx}:${ty}`;
        this.dirtyTiles.add(key);
        // ... rest of draw logic
        const localX = world.x - (tx * TILE_SIZE);
        const localY = world.y - (ty * TILE_SIZE);

        // Check if within bounds (optimization)? 
        // Shader discards anyway, but good to know.

        // We need a specific Uniform Buffer for EACH draw call because we change localX/localY?
        // OR: We change the implementation to pass localPos in Push Constants (not avail in WebGPU)
        // OR: Use dynamic offsets.
        // OR: Just writeBuffer before each pass? 
        // LIMITATION: writeBuffer puts commands in Queue. RenderPass is encoded synchronously.
        // You cannot interleave queue.writeBuffer inside a CommandEncoder recording easily without multiple submits for same resource.
        // FIX: Create a temporary buffer for each draw call (mappedAtCreation or createBuffer+writeBuffer).
        // Since this is 1-4 tiles max, creating 4 small buffers is fine.

        const uniforms = new Float32Array([
          brushColor.r, brushColor.g, brushColor.b, brushColor.a,
          localX, localY,
          brushSize, 0
        ]);

        const uniformBuffer = this.device.createBuffer({
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          mappedAtCreation: true
        });
        new Float32Array(uniformBuffer.getMappedRange()).set(uniforms);
        uniformBuffer.unmap();

        // We need a BindGroup for THIS buffer
        const bg = this.device.createBindGroup({
          layout: activePipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
        });

        const renderPass = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: texture.createView(),
            loadOp: 'load',
            storeOp: 'store'
          }]
        });

        renderPass.setPipeline(activePipeline);
        renderPass.setBindGroup(0, bg);
        renderPass.draw(6);
        renderPass.end();
        hasWork = true;
      }
    }

    if (hasWork) {
      this.device.queue.submit([commandEncoder.finish()]);
    }
  }

  // Linear Interpolation for smooth strokes
  private interpolateStroke(x1: number, y1: number, x2: number, y2: number, pressure: number) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const stepSize = 5; // Pixel step
    const steps = Math.ceil(dist / stepSize);

    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      this.drawStroke(x, y, pressure);
    }
    // Ensure specific last point is drawn
    this.drawStroke(x2, y2, pressure);
  }

  private activeLayerId: string = 'layer-1';

  // --- Public API for UI ---

  public setTool(tool: 'brush' | 'eraser') {
    this.activeTool = tool;
    this.notifyListeners();
  }

  public getTool() {
    return this.activeTool;
  }

  public setBrushColor(r: number, g: number, b: number) {
    this.brushColor = { r, g, b, a: 1.0 };
    this.notifyListeners();
  }

  public getBrushColor() {
    return this.brushColor;
  }

  public setBrushSize(size: number) {
    this.brushSize = size;
    this.notifyListeners();
  }

  public getBrushSize() {
    return this.brushSize;
  }

  public toggleLayer(layerId: string) {
    const layer = this.layers.find(l => l.id === layerId);
    if (layer) {
      layer.visible = !layer.visible;
      this.notifyListeners();
      this.tileManager?.getPersistence().saveLayers(this.layers);
    }
  }

  public setActiveLayer(layerId: string) {
    const layer = this.layers.find(l => l.id === layerId);
    if (layer) {
      this.activeLayerId = layerId;
      this.notifyListeners();
      // No need to save active layer selection unless we persist that too? Not crucial.
    }
  }

  public getActiveLayer() {
    return this.activeLayerId;
  }

  public addLayer(name: string = "New Layer") {
    const id = `layer-${Date.now()}`;
    // Add to top (index 0 is bottom, usually render order is 0->N, so N is top)
    // Actually typically layers list is Top-to-Bottom in UI, but Bottom-to-Top in Rendering.
    // Let's assume list index 0 = Background (Bottom).
    // So we push to end.
    this.layers.push({
      id: id,
      name: name,
      visible: true,
      opacity: 1.0
    });
    this.activeLayerId = id; // Auto-select new layer
    this.notifyListeners();
    this.tileManager?.getPersistence().saveLayers(this.layers);
  }

  public deleteLayers(layerIds: string[]) {
    // Prevent deleting all layers? Maybe keep at least one?
    const kept = this.layers.filter(l => !layerIds.includes(l.id));
    if (kept.length === 0) return; // Cannot delete all

    this.layers = kept;

    // If active layer was deleted, reset active to top-most
    if (!this.layers.find(l => l.id === this.activeLayerId)) {
      this.activeLayerId = this.layers[this.layers.length - 1].id;
    }

    this.notifyListeners();
    this.tileManager?.getPersistence().saveLayers(this.layers);
  }

  public getLayers() {
    return [...this.layers]; // Returns Bottom-to-Top order (render order)
  }

  public debugGrid: boolean = false;

  public setDebugGrid(enabled: boolean) {
    this.debugGrid = enabled;
    // Don't need to notify listeners unless UI needs to know, but UI sets it.
  }

  public subscribe(callback: () => void) {
    this.listeners.add(callback);
    return () => { this.listeners.delete(callback); };
  }

  private notifyListeners() {
    this.listeners.forEach(cb => cb());
  }

  private onResize = () => {
    this.resize();
  };

  private resize() {
    if (!this.canvas || !this.device) return;

    // Handle DPI scaling
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';

    this.viewport.width = width;
    this.viewport.height = height;
  }

  private startRenderLoop() {
    const render = () => {
      this.draw();
      this.animationFrameId = requestAnimationFrame(render);
    };
    this.animationFrameId = requestAnimationFrame(render);
  }

  private draw() {
    if (!this.device || !this.context || !this.tileManager || !this.pipeline || !this.uniformBuffer || !this.bindGroupParams) return;

    this.tileManager.update(this.viewport, this.layers);

    const uniforms = new Float32Array([
      this.viewport.width, this.viewport.height,
      this.viewport.x, this.viewport.y,
      this.viewport.zoom, this.debugGrid ? 1.0 : 0.0, 0, 0
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const renderPassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.96, g: 0.96, b: 0.96, a: 1.0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    };

    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(this.pipeline);

    passEncoder.setBindGroup(0, this.bindGroupParams);

    const visibleTiles = this.tileManager.getVisibleTiles(this.layers);

    // Reusing the same buffer for all tiles would be a race condition if we used writeBuffer inside the pass?
    // Actually, writeBuffer happens on Queue. Render Pass recording is separate.
    // If I record "Draw Tile A", then "Draw Tile B", but update the buffer in between...
    // The command buffer captures the state of BINDINGS? No, it captures the command.
    // But the BUFFER content is read at Execution time (Submit).
    // So if I update the buffer 10 times and submit once, all draws see the LAST value.
    // PROBLEM: I need a Dynamic Uniform Buffer or a buffer per tile.

    // Solution for MVP: Create a new buffer for each tile every frame? (Garbage heavy but safe)
    // Or: Create one big buffer and use dynamic offsets.
    // "Dynamic Uniform Buffer" limited to 8 or something.

    // Let's use "MappedAtCreation" helper to create a fresh buffer for each tile this frame.
    // It is slow but correctness is guaranteed.

    for (const tile of visibleTiles) {
      if (!tile.texture) continue;

      const tilePosBuffer = this.device.createBuffer({
        size: 16, // vec2f + f32 + f32 (padding) = 16 bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true
      });

      const scale = Math.pow(2, tile.level);
      const tileX = tile.tx * TILE_SIZE * scale;
      const tileY = tile.ty * TILE_SIZE * scale;

      new Float32Array(tilePosBuffer.getMappedRange()).set([tileX, tileY, scale, 0]);
      tilePosBuffer.unmap();

      const bg1 = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: tile.texture.createView() },
          { binding: 1, resource: { buffer: tilePosBuffer } }
        ]
      });

      passEncoder.setBindGroup(1, bg1);
      passEncoder.draw(6);
    }

    passEncoder.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }

  public destroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    window.removeEventListener("resize", this.onResize);
    this.device = null;
    this.context = null;
  }
}
