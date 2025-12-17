"use client";

import React, { createContext, useContext, useRef, useEffect, useState, ReactNode } from "react";
import { CanvasManager } from "@/engine/CanvasManager";

interface CanvasContextType {
    engine: CanvasManager | null;
    canvasElement: HTMLCanvasElement | null;
    registerCanvas: (canvas: HTMLCanvasElement) => void;
}

const CanvasContext = createContext<CanvasContextType | null>(null);

export const useCanvas = () => {
    const context = useContext(CanvasContext);
    if (!context) {
        throw new Error("useCanvas must be used within CanvasProvider");
    }
    return context;
};

interface CanvasProviderProps {
    children: ReactNode;
}

export const CanvasProvider: React.FC<CanvasProviderProps> = ({ children }) => {
    const [engine, setEngine] = useState<CanvasManager | null>(null);
    const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
    const engineRef = useRef<CanvasManager | null>(null);
    const initializingRef = useRef(false);

    const registerCanvas = (canvas: HTMLCanvasElement) => {
        if (canvasElement === canvas) return; // Already registered
        setCanvasElement(canvas);
    };

    useEffect(() => {
        if (!canvasElement || engineRef.current || initializingRef.current) return;

        initializingRef.current = true;

        const initEngine = async () => {
            try {
                console.log("Initializing CanvasManager singleton...");
                const instance = new CanvasManager(canvasElement);
                await instance.initialize();
                engineRef.current = instance;
                setEngine(instance);
                console.log("CanvasManager singleton initialized successfully");
            } catch (err) {
                console.error("Failed to initialize CanvasManager:", err);
            } finally {
                initializingRef.current = false;
            }
        };

        initEngine();

        return () => {
            if (engineRef.current) {
                console.log("Destroying CanvasManager singleton...");
                engineRef.current.destroy();
                engineRef.current = null;
            }
        };
    }, [canvasElement]);

    return (
        <CanvasContext.Provider value={{ engine, canvasElement, registerCanvas }}>
            {children}
        </CanvasContext.Provider>
    );
};
