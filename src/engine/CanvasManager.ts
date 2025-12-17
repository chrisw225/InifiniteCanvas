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
  public activeLayerId: string = 'layer-1'; // Default to Drawing layer

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
  public activeTool: 'brush' | 'eraser' = 'brush';
  public brushColor: { r: number, g: number, b: number, a: number } = { r: 0, g: 0, b: 0, a: 1 };
  public brushSize: number = 50;

  private strokePoints: { x: number, y: number, pressure: number }[] = [];
  private overlayTexture: GPUTexture | null = null;
  private overlayPipeline: GPURenderPipeline | null = null;
  private overlayCompositePipeline: GPURenderPipeline | null = null;

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

    // Initialize Sampler for texture sampling
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

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
                    let w = 0.005; // Thickness
                    let onLeft = uv.x < w;
                    let onRight = uv.x > 1.0 - w;
                    let onTop = uv.y < w;
                    let onBottom = uv.y > 1.0 - w;
                    
                    if (onLeft || onRight || onTop || onBottom) {
                        let dashX = sin(uv.x * 150.0);
                        let dashY = sin(uv.y * 150.0);
                        
                        var draw = false;
                        if ((onLeft || onRight) && dashY > 0.0) { draw = true; }
                        if ((onTop || onBottom) && dashX > 0.0) { draw = true; }
                        
                        if (draw) {
                            // Color code by Level
                            let level = log2(tile.scale);
                            
                            if (level < 0.5) { return vec4f(1.0, 0.0, 0.0, 1.0); } // Red = Level 0
                            else if (level < 1.5) { return vec4f(0.0, 1.0, 0.0, 1.0); } // Green = Level 1
                            else if (level < 2.5) { return vec4f(0.0, 0.0, 1.0, 1.0); } // Blue = Level 2
                            else { return vec4f(1.0, 1.0, 0.0, 1.0); } // Yellow = Level 3+
                        }
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
                 pos: vec2f, 
                 targetSize: vec2f,
                 size: f32,  
                 padding: vec3f,
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
                
                let x_pix = (p.x + 1.0) * 0.5 * brush.targetSize.x;
                // y: -1 is bottom? WebGPU clip Y is up? 
                // In render pass to texture, usually standard Y up? 
                // Let's assume (0,0) is top-left for TILE pixel coord logic.
                // Clip (-1, -1) = Bottom Left, (1, 1) = Top Right.
                // Texture Coord: (0, 0) = Top Left usually.
                // So Y needs flip.
                
                let y_pix = (1.0 - p.y) * 0.5 * brush.targetSize.y; // Flip Y
                
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
      size: 64, // Aligned to 64 bytes
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

  private initOverlayCompositePipeline() {
    if (this.overlayCompositePipeline) return;
    const shaderModule = this.device!.createShaderModule({
      code: `
            struct VertexOutput {
                @builtin(position) Position : vec4f,
                @location(0) uv : vec2f,
            };
            
            @vertex
            fn vert_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
                var output : VertexOutput;
                var pos = array<vec2f, 6>(
                    vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),
                    vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0)
                );
                let p = pos[VertexIndex];
                output.Position = vec4f(p, 0.0, 1.0);
                output.uv = vec2f((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5); 
                return output;
            }
            
            @group(0) @binding(0) var myTexture : texture_2d<f32>;
            @group(0) @binding(1) var mySampler : sampler;
            
            @fragment
            fn frag_main(@location(0) uv : vec2f) -> @location(0) vec4f {
                return textureSample(myTexture, mySampler, uv);
            }
          `
    });

    const bindGroupLayout = this.device!.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} }
      ]
    });

    const layout = this.device!.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

    this.overlayCompositePipeline = this.device!.createRenderPipeline({
      layout,
      vertex: { module: shaderModule, entryPoint: 'vert_main' },
      fragment: {
        module: shaderModule,
        entryPoint: 'frag_main',
        targets: [{
          format: navigator.gpu.getPreferredCanvasFormat(),
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
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

  private getCanvasCoordinates(clientX: number, clientY: number): { x: number, y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
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
      this.clearOverlay(); // Clear ghost on zoom
      this.notifyListeners();
      // Ideally zoom towards pointer, but keeping simple for now
    }, { passive: false });

    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      const coords = this.getCanvasCoordinates(e.clientX, e.clientY);

      if (this.isSpacePressed || e.button === 1 || e.button === 2) {
        this.isPanning = true;
        this.lastPointerPos = coords;
        this.clearOverlay(); // Clear ghost when starting to pan
        this.canvas.style.cursor = 'grabbing';
      } else if (e.buttons === 1) {
        // Start Drawing
        this.isPanning = false;
        this.lastPointerPos = coords;
        this.strokePoints = []; // Reset Stroke Buffer
        // Do we draw the first point?
        // pointermove will handle it.
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const coords = this.getCanvasCoordinates(e.clientX, e.clientY);

      if (this.isPanning) {
        const dx = coords.x - this.lastPointerPos.x;
        const dy = coords.y - this.lastPointerPos.y;
        this.viewport.x -= dx / this.viewport.zoom;
        this.viewport.y -= dy / this.viewport.zoom;
        this.lastPointerPos = coords;
        this.notifyListeners();
      } else if (e.buttons === 1 && this.activeTool) {
        // Drawing
        // Interpolate
        this.interpolateStroke(this.lastPointerPos.x, this.lastPointerPos.y, coords.x, coords.y, e.pressure);
        this.lastPointerPos = coords;
      }
    });

    this.canvas.addEventListener('pointerup', (e) => {
      this.canvas.releasePointerCapture(e.pointerId);
      if (this.isPanning) {
        this.isPanning = false;
        this.canvas.style.cursor = this.isSpacePressed ? 'grab' : 'default';
      } else {
        // Commit the buffered stroke to tiles (LOD 0) - fire and forget for responsiveness
        this.commitStroke().catch(err => console.error('Stroke commit error:', err));
      }
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

  private drawStroke(screenX: number, screenY: number, pressure: number) {
    if (!this.tileManager || !this.device || !this.brushPipeline || !this.eraserPipeline || !this.brushBindGroup || !this.brushUniformBuffer) return;

    const world = this.screenToWorld(screenX, screenY);
    this.strokePoints.push({ x: world.x, y: world.y, pressure });

    // Draw to Overlay for feedback
    if (this.overlayTexture) {
      // Prevent Eraser from drawing on overlay to be confusing? 
      // For now, let's draw eraser as White or just standard blend?
      // If alpha blend: Eraser (alpha 1) -> Destination Alpha?
      // Simpler: Just render brush strokes. If eraser, maybe skip overlay feedback or render Red?
      // Let's render everything using brush pipeline logic but different blending?

      const isEraser = this.activeTool === 'eraser';
      // Just use Brush Pipeline for overlay feedback always? 
      // If eraser, we maybe want to see where we are erasing.
      // Let's use BrushPipeline always for Overlay but with a faint color if eraser?
      const activePipeline = isEraser ? this.brushPipeline : (this.activeTool === 'eraser' ? this.eraserPipeline : this.brushPipeline);
      // Actually current pipeline handles blending.
      // If we use EraserPipeline on Overlay, it subtracts alpha. Overlay is empty (alpha 0). So it does nothing invisible.
      // So for Eraser, we should probably render a visual indicator (like a white/pink stroke).
      const renderColor = isEraser ? { r: 1, g: 0.8, b: 0.8, a: 0.5 } : this.brushColor;
      const renderPipeline = this.brushPipeline; // Always use additive/alpha brush for visual feedback

      const brushSize = this.brushSize * pressure * this.viewport.zoom; // Scale visual brush to match zoom? 
      // Actually screen size of brush should be constant?
      // No, `brushSize` is World Units.
      // Screen Space Size = WorldSize * Zoom.
      // The Shader expects `size` in same units as `pos`.
      // `pos` is Screen Pixels.
      // So `size` must be Screen Pixels.
      const screenBrushSize = (this.brushSize * pressure) * this.viewport.zoom;

      const uniforms = new Float32Array([
        renderColor.r, renderColor.g, renderColor.b, renderColor.a,
        screenX, screenY,
        this.viewport.width, this.viewport.height,
        screenBrushSize, 0, 0, 0,
        0, 0, 0, 0
      ]);

      const uniformBuffer = this.device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true
      });
      new Float32Array(uniformBuffer.getMappedRange()).set(uniforms);
      uniformBuffer.unmap();

      const bg = this.device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
      });

      const commandEncoder = this.device.createCommandEncoder();
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: this.overlayTexture.createView(),
          loadOp: 'load',
          storeOp: 'store'
        }]
      });

      renderPass.setPipeline(renderPipeline);
      renderPass.setBindGroup(0, bg);
      renderPass.draw(6);
      renderPass.end();

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

  private clearOverlay() {
    if (!this.overlayTexture || !this.device) return;
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.overlayTexture.createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 0 }
      }]
    });
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  private async commitStroke() {
    console.log('[commitStroke] Starting, strokePoints:', this.strokePoints.length);
    console.log('[commitStroke] activeLayerId:', this.activeLayerId);

    if (this.strokePoints.length === 0) {
      console.log('[commitStroke] No stroke points, returning');
      return;
    }

    // 1. Calculate AABB of stroke
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let maxPressure = 0;
    for (const p of this.strokePoints) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
      if (p.pressure > maxPressure) maxPressure = p.pressure;
    }

    // Expand by max brush size
    const margin = this.brushSize * 1.0; // max possible size roughly
    minX -= margin; minY -= margin; maxX += margin; maxY += margin;

    // Calculate current LOD level (same logic as TileManager.update)
    const currentLevel = Math.max(0, Math.floor(Math.log2(1 / this.viewport.zoom)));
    const scale = Math.pow(2, currentLevel);
    const tileSizeWorld = TILE_SIZE * scale;

    console.log('[commitStroke] Current LOD level:', currentLevel, 'scale:', scale);

    // 2. Identify Tiles at current LOD level
    const minTx = Math.floor(minX / tileSizeWorld);
    const maxTx = Math.floor(maxX / tileSizeWorld);
    const minTy = Math.floor(minY / tileSizeWorld);
    const maxTy = Math.floor(maxY / tileSizeWorld);

    console.log('[commitStroke] Tile range:', { minTx, maxTx, minTy, maxTy });

    const activePipeline = this.activeTool === 'eraser' ? this.eraserPipeline : this.brushPipeline;
    const brushColor = this.brushColor;

    // 3. Process Tiles
    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let ty = minTy; ty <= maxTy; ty++) {
        // Ensure tile is loaded at current LOD level
        const key = `${this.activeLayerId}:${currentLevel}:${tx}:${ty}`;

        console.log('[commitStroke] Processing tile:', key);

        // Check memory
        let tile = this.tileManager.getTileByKey(key);

        if (!tile) {
          // Force Load at current level
          await this.tileManager.forceLoadTile(this.activeLayerId, tx, ty, currentLevel);
          tile = this.tileManager.getTileByKey(key);
        }

        if (tile && tile.texture && tile.status === 'ready') {
          const commandEncoder = this.device!.createCommandEncoder();
          const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
              view: tile.texture.createView(),
              loadOp: 'load',
              storeOp: 'store'
            }]
          });

          renderPass.setPipeline(activePipeline!);

          // Draw all points
          for (const p of this.strokePoints) {
            const localX = p.x - (tx * tileSizeWorld);
            const localY = p.y - (ty * tileSizeWorld);
            const size = this.brushSize * p.pressure;

            // Frustum cull point against tile? Optimization.
            if (localX < -size || localX > TILE_SIZE + size || localY < -size || localY > TILE_SIZE + size) continue;

            const uniforms = new Float32Array([
              brushColor.r, brushColor.g, brushColor.b, brushColor.a,
              localX, localY,
              TILE_SIZE, TILE_SIZE,
              size, 0, 0, 0,
              0, 0, 0, 0
            ]);

            // Dynamic buffer creation (slow but safe)
            // Optimization: Reuse one big buffer with dynamic offsets? 
            // MVP: Create buffer
            const uBuffer = this.device!.createBuffer({
              size: 64,
              usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
              mappedAtCreation: true
            });
            new Float32Array(uBuffer.getMappedRange()).set(uniforms);
            uBuffer.unmap();

            const bg = this.device!.createBindGroup({
              layout: activePipeline!.getBindGroupLayout(0),
              entries: [{ binding: 0, resource: { buffer: uBuffer } }]
            });

            renderPass.setBindGroup(0, bg);
            renderPass.draw(6);
          }

          renderPass.end();
          this.device!.queue.submit([commandEncoder.finish()]);

          // Save and Invalidate
          // We should await this? Or fire/forget?
          // await this.tileManager.saveTile(...) might be slow.
          // Fire and forget is better for UI responsiveness, but might race.
          // Let's await to be safe.
          await this.tileManager.saveTile(this.activeLayerId, tx, ty, 0);
        }
      }
    }

    // 4. Cleanup
    this.strokePoints = [];

    // Clear Overlay
    this.clearOverlay();
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

  public resize = () => {
    if (!this.canvas || !this.device) return;

    // Handle DPI scaling
    const dpr = window.devicePixelRatio || 1;

    // Use Parent Element size if available (for Dock Layout), otherwise Window
    const parent = this.canvas.parentElement;
    const width = parent ? parent.clientWidth : window.innerWidth;
    const height = parent ? parent.clientHeight : window.innerHeight;

    console.log("CanvasManager.resize() called:", { width, height, dpr, hasParent: !!parent });

    if (width === 0 || height === 0) return; // Avoid invalid texture creation

    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';

    this.viewport.width = width;
    this.viewport.height = height;

    if (this.overlayTexture) this.overlayTexture.destroy();
    this.overlayTexture = this.device.createTexture({
      size: [width, height],
      format: navigator.gpu.getPreferredCanvasFormat(),
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });

    // Force redraw
    this.draw();
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

    // Draw Overlay
    if (this.overlayTexture) {
      if (!this.overlayCompositePipeline) this.initOverlayCompositePipeline();

      const bg = this.device.createBindGroup({
        layout: this.overlayCompositePipeline!.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.overlayTexture.createView() },
          { binding: 1, resource: this.sampler }
        ]
      });

      passEncoder.setPipeline(this.overlayCompositePipeline!);
      passEncoder.setBindGroup(0, bg);
      passEncoder.draw(6);
    }

    passEncoder.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }

  public addListener(listener: () => void) {
    this.listeners.add(listener);
  }

  public removeListener(listener: () => void) {
    this.listeners.delete(listener);
  }

  public notifyListeners() {
    this.listeners.forEach(listener => listener());
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
