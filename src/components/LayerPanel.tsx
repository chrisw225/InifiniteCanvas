"use client";



import React, { useEffect, useState } from 'react';
import { CanvasManager } from '@/engine/CanvasManager';
import { Layer } from '@/types/shared';
import styles from './LayerPanel.module.css';

interface LayerPanelProps {
    engine: CanvasManager | null;
}

export default function LayerPanel({ engine }: LayerPanelProps) {
    const [layers, setLayers] = useState<Layer[]>([]);
    const [activeLayerId, setActiveLayerId] = useState<string>('');
    const [selectedLayerIds, setSelectedLayerIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!engine) return;

        const updateState = () => {
            setLayers(engine.getLayers());
            // Engine doesn't "push" active layer yet in getLayers? 
            // We added getActiveLayer().
            const active = engine.getActiveLayer();
            setActiveLayerId(active);

            // If active layer changes, ensure it's in selection? Or separate concepts?
            // Photoshop: Active layer IS selected. Selection includes Active + others.
            // Let's sync selection to include active if it wasn't.
            // Actually simpliest logic: Active is just "Target for Drawing". Selection is "Target for Operations".
        };

        updateState();

        // Subscribe to engine changes
        const unsubscribe = engine.subscribe(updateState);
        return () => { unsubscribe(); };
    }, [engine]);

    // Click Handler: Set Active. Modifiers for Selection.
    const handleLayerClick = (e: React.MouseEvent, layerId: string) => {
        if (!engine) return;

        if (e.ctrlKey || e.metaKey) {
            // Toggle Selection
            const newSet = new Set(selectedLayerIds);
            if (newSet.has(layerId)) {
                newSet.delete(layerId);
            } else {
                newSet.add(layerId);
            }
            setSelectedLayerIds(newSet);
            // Don't change active layer on Ctrl+Click usually? 
            // PS: Ctrl+Click toggles selection. Active layer remains unless we clicked it?
            // MVP: If you Ctrl click, we just update selection set.
        } else {
            // Normal Click: Set Active and reset Selection to JUST this layer
            engine.setActiveLayer(layerId);
            setSelectedLayerIds(new Set([layerId]));
        }
    };

    const toggleVisibility = (e: React.MouseEvent, layerId: string) => {
        e.stopPropagation(); // Don't select row
        if (!engine) return;
        engine.toggleLayer(layerId);
    };

    const cleanAddLayer = () => {
        if (!engine) return;
        engine.addLayer(`Layer ${layers.length + 1}`);
    };

    const cleanDeleteLayers = () => {
        if (!engine) return;
        // Delete selected
        // If selection empty, delete active?
        const toDelete = selectedLayerIds.size > 0 ? Array.from(selectedLayerIds) : [activeLayerId];
        engine.deleteLayers(toDelete);
        setSelectedLayerIds(new Set()); // Clear selection
    };

    // Render Bottom-to-Top layers as Top-to-Bottom list
    // layers[0] is background. layers[N] is top.
    // We want list to show N first.
    const reversedLayers = [...layers].reverse();

    return (
        <div className={styles.panel}>
            <h3 className={styles.title}>Layers</h3>

            <div className={styles.list}>
                {reversedLayers.map(layer => {
                    const isActive = layer.id === activeLayerId;
                    const isSelected = selectedLayerIds.has(layer.id) || isActive; // Active implies selected usually

                    return (
                        <div
                            key={layer.id}
                            className={`${styles.layerItem} ${isActive ? styles.active : ''} ${isSelected ? styles.selected : ''}`}
                            onClick={(e) => handleLayerClick(e, layer.id)}
                        >
                            <div
                                className={`${styles.eyeWrapper} ${!layer.visible ? styles.eyeHidden : ''}`}
                                onClick={(e) => toggleVisibility(e, layer.id)}
                                title="Toggle Visibility"
                            >
                                👁️
                            </div>
                            <span className={styles.layerName}>{layer.name}</span>
                        </div>
                    );
                })}
            </div>

            <div className={styles.footer}>
                <button className={styles.iconBtn} onClick={cleanAddLayer} title="Add New Layer">
                    ➕
                </button>
                <button className={styles.iconBtn} onClick={cleanDeleteLayers} title="Delete Selected Layers">
                    🗑️
                </button>
            </div>
        </div>
    );
}
