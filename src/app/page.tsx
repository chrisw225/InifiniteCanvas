"use client";

import { useEffect, useRef, useState } from "react";
import { CanvasManager } from "@/engine/CanvasManager";
import ToolPanel from "@/components/ToolPanel";
import LayerPanel from "@/components/LayerPanel";
import { StatusPanel } from "@/components/StatusPanel";

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
  }, []); // Run once

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
    <main style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", touchAction: "none" }}
      />
      {engine && (
        <>
          <ToolPanel engine={engine} />
          <LayerPanel engine={engine} />
          <StatusPanel engine={engine} />
        </>
      )}
    </main>
  );
}
