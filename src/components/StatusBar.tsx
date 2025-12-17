import React from "react";
import { CanvasManager } from "@/engine/CanvasManager";

interface StatusBarProps {
    engine: CanvasManager;
}

export const StatusBar: React.FC<StatusBarProps> = ({ engine }) => {
    const [zoom, setZoom] = React.useState(engine.viewport.zoom);
    const [debugGrid, setDebugGrid] = React.useState(engine.debugGrid);

    React.useEffect(() => {
        const listener = () => {
            setZoom(engine.viewport.zoom);
            setDebugGrid(engine.debugGrid);
        };
        engine.addListener(listener);
        return () => engine.removeListener(listener);
    }, [engine]);

    const statusBarStyle: React.CSSProperties = {
        height: "25px",
        background: "#2b2b2b",
        borderTop: "1px solid #1e1e1e",
        display: "flex",
        alignItems: "center",
        padding: "0 10px",
        fontSize: "11px",
        color: "#999",
        gap: "20px"
    };

    const buttonStyle: React.CSSProperties = {
        background: debugGrid ? "#3a3a3a" : "transparent",
        border: "1px solid #555",
        color: "#cccccc",
        padding: "2px 8px",
        borderRadius: "3px",
        cursor: "pointer",
        fontSize: "11px"
    };

    return (
        <div style={statusBarStyle}>
            <span>Zoom: {(zoom * 100).toFixed(0)}%</span>
            <span>|</span>
            <span>Position: ({engine.viewport.x.toFixed(0)}, {engine.viewport.y.toFixed(0)})</span>
            <span>|</span>
            <button
                style={buttonStyle}
                onClick={() => engine.setDebugGrid(!engine.debugGrid)}
            >
                Grid: {debugGrid ? "ON" : "OFF"}
            </button>
        </div>
    );
};
