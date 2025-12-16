"use client";

import { useEffect, useRef, useState } from "react";
import { CanvasManager } from "@/engine/CanvasManager";

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<CanvasManager | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const initEngine = async () => {
      try {
        const engine = new CanvasManager(canvasRef.current!);
        await engine.initialize();
        engineRef.current = engine;
      } catch (err) {
        console.error("Failed to initialize engine:", err);
        setError((err as Error).message);
      }
    };

    initEngine();

    return () => {
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
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
    <main style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", touchAction: "none" }}
      />
    </main>
  );
}
