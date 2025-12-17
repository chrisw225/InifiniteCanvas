"use client";

import React, { useEffect, useState } from 'react';
import { CanvasManager } from '@/engine/CanvasManager';
import styles from './ToolPanel.module.css';

interface ToolPanelProps {
    engine: CanvasManager | null;
}

export default function ToolPanel({ engine }: ToolPanelProps) {
    const [activeTool, setActiveTool] = useState<'brush' | 'eraser'>('brush');
    const [brushSize, setBrushSize] = useState(50);
    const [color, setColor] = useState('#000000');

    useEffect(() => {
        if (!engine) return;

        // Initial state
        setActiveTool(engine.getTool());
        setBrushSize(engine.getBrushSize());
        const c = engine.getBrushColor();
        // Simple RGB to Hex for initial state if needed, or just keep default
        // We'll trust local state for now or sync if we add hex conversion

        // Subscribe to changes (e.g. from keyboard shortcuts)
        const unsubscribe = engine.subscribe(() => {
            setActiveTool(engine.getTool());
            setBrushSize(engine.getBrushSize());
        });

        return () => { unsubscribe(); };
    }, [engine]);

    const handleToolChange = (tool: 'brush' | 'eraser') => {
        if (!engine) return;
        engine.setTool(tool);
        setActiveTool(tool);
        // Focus canvas back so shortcuts work immediately? 
        // Maybe unnecessary if we don't blur too much.
    };

    const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!engine) return;
        const hex = e.target.value;
        setColor(hex);

        // Hex to RGB
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;

        engine.setBrushColor(r, g, b);
    };

    const handleSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!engine) return;
        const size = parseFloat(e.target.value);
        setBrushSize(size);
        engine.setBrushSize(size);
    };

    return (
        <div className={styles.panel}>
            <div className={styles.row}>
                <button
                    className={`${styles.button} ${activeTool === 'brush' ? styles.active : ''}`}
                    onClick={() => handleToolChange('brush')}
                    title="Brush (B)"
                >
                    🖌️
                </button>
                <button
                    className={`${styles.button} ${activeTool === 'eraser' ? styles.active : ''}`}
                    onClick={() => handleToolChange('eraser')}
                    title="Eraser (E)"
                >
                    🧹
                </button>
            </div>

            <div className={styles.row}>
                <label className={styles.label}>Color</label>
                <input
                    type="color"
                    value={color}
                    onChange={handleColorChange}
                    className={styles.colorInput}
                />
            </div>

            <div className={styles.column}>
                <label className={styles.label}>Size: {brushSize.toFixed(0)}</label>
                <input
                    type="range"
                    min="1"
                    max="200"
                    value={brushSize}
                    onChange={handleSizeChange}
                    className={styles.slider}
                />
            </div>
        </div>
    );
}
