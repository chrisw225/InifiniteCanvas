import { ViewportState, TILE_SIZE } from "@/types/shared";

export class CanvasManager {
  private canvas: HTMLCanvasElement;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private animationFrameId: number | null = null;

  public viewport: ViewportState = {
    x: 0,
    y: 0,
    zoom: 1,
    width: 0,
    height: 0,
  };

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

    // Initial resize to set viewport dimensions
    this.resize();
    window.addEventListener("resize", this.onResize);

    this.startRenderLoop();
    console.log("CanvasManager initialized successfully");
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
    if (!this.device || !this.context) return;

    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const renderPassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.96, g: 0.96, b: 0.96, a: 1.0 }, // Light gray background
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    };

    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    // TODO: Render tiles here
    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  public destroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    window.removeEventListener("resize", this.onResize);
    // WebGPU resources are automatically cleaned up when the device is lost, 
    // but good practice to remove references.
    this.device = null;
    this.context = null;
  }
}
