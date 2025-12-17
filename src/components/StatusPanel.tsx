import React, { useEffect, useState } from 'react';
import styles from './StatusPanel.module.css';
import { CanvasManager } from '@/engine/CanvasManager';

interface StatusPanelProps {
    engine: CanvasManager | null;
}

export const StatusPanel: React.FC<StatusPanelProps> = ({ engine }) => {
    const [zoom, setZoom] = useState(100);
    const [showGrid, setShowGrid] = useState(false);

    useEffect(() => {
        if (!engine) return;

        const update = () => {
            setZoom(Math.round(engine.viewport.zoom * 100));
        };

        // Initial value
        update();
        setShowGrid(!!engine.debugGrid);

        // Subscribe to changes
        const unsubscribe = engine.subscribe(update);
        return unsubscribe;
    }, [engine]);

    const handleGridToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!engine) return;
        const val = e.target.checked;
        setShowGrid(val);
        if (typeof engine.setDebugGrid === 'function') {
            engine.setDebugGrid(val);
        } else {
            console.warn("setDebugGrid not found on engine instance");
        }
    };

    if (!engine) return null;

    return (
        <div className={styles.panel}>
            <div className={styles.zoom}>{zoom}%</div>
            <div className={styles.controls}>
                <input
                    type="checkbox"
                    id="debugGrid"
                    className={styles.checkbox}
                    checked={showGrid}
                    onChange={handleGridToggle}
                />
                <label htmlFor="debugGrid" className={styles.label}>LOD Grid</label>
            </div>
        </div>
    );
};
