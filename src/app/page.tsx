"use client";

import { useEffect, useRef, useState } from "react";
import { CanvasManager } from "@/engine/CanvasManager";
import { MenuBar } from "@/components/MenuBar";
import { ToolSidebar } from "@/components/ToolSidebar";
import { ColorPickerPanel } from "@/components/ColorPickerPanel";
import { BrushSettingsPanel } from "@/components/BrushSettingsPanel";
import LayerPanel from "@/components/LayerPanel";
import { StatusBar } from "@/components/StatusBar";

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<CanvasManager | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const initEngine = async () => {
      try {
        const instance = new CanvasManager(canvasRef.current!);
        await instance.initialize();
        setEngine(instance);
      } catch (err) {
        console.error("Failed to initialize engine:", err);
        setError((err as Error).message);
      }
    };

    initEngine();

    return () => {
      if (engine) {
        engine.destroy();
      }
    };
  }, []);

  if (error) {
    return (
      <div style={{ padding: 20, color: "red" }}>
        <h1>Error</h1>
        <p>{error}</p>
        <p>Ensure you are using a browser with WebGPU support (Chrome 113+, Edge 113+).</p>
      </div>
    );
  }

  return (
    <main style={{
      width: "100vw",
      height: "100vh",
      display: "grid",
      gridTemplateRows: "30px 1fr 25px",
      gridTemplateColumns: "50px 1fr 280px",
      overflow: "hidden",
      background: "#1e1e1e"
    }}>
      {/* Menu Bar - spans all columns */}
      <div style={{ gridRow: "1", gridColumn: "1 / -1" }}>
        <MenuBar />
      </div>

      {/* Tool Sidebar */}
      <div style={{ gridRow: "2", gridColumn: "1" }}>
        {engine && <ToolSidebar engine={engine} />}
      </div>

      {/* Canvas Area */}
      <div style={{ gridRow: "2", gridColumn: "2", position: "relative", background: "#3a3a3a" }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", touchAction: "none", display: "block" }}
        />
      </div>

      {/* Right Panel - Color, Brush, Layers */}
      <div style={{
        gridRow: "2",
        gridColumn: "3",
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
        background: "#2b2b2b"
      }}>
        {engine && (
          <>
            <ColorPickerPanel engine={engine} />
            <BrushSettingsPanel engine={engine} />
            <div style={{ flex: 1, overflow: "auto" }}>
              <LayerPanel engine={engine} />
            </div>
          </>
        )}
      </div>

      {/* Status Bar - spans all columns */}
      <div style={{ gridRow: "3", gridColumn: "1 / -1" }}>
        {engine && <StatusBar engine={engine} />}
      </div>
    </main>
  );
}
