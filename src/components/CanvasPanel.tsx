"use client";

import React, { useRef, useEffect } from "react";
import { useCanvas } from "@/contexts/CanvasContext";

export const CanvasPanel: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { engine, registerCanvas } = useCanvas();

    // Register canvas with context on mount
    useEffect(() => {
        if (canvasRef.current) {
            registerCanvas(canvasRef.current);
        }
    }, [registerCanvas]);

    // Handle container resize
    useEffect(() => {
        if (!engine || !containerRef.current) return;

        console.log("Setting up ResizeObserver for canvas container");
        console.log("Container dimensions:", containerRef.current.clientWidth, "x", containerRef.current.clientHeight);

        // Trigger immediate resize
        engine.resize();

        const observer = new ResizeObserver(() => {
            console.log("Container resized, calling engine.resize()");
            engine.resize();
        });

        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, [engine]);

    return (
        <div ref={containerRef} className="absolute inset-0 bg-gray-900">
            <canvas
                ref={canvasRef}
                className="w-full h-full"
                style={{ touchAction: "none" }}
            />
            {!engine && (
                <div className="absolute inset-0 flex items-center justify-center text-white">
                    Initializing Canvas...
                </div>
            )}
        </div>
    );
};
