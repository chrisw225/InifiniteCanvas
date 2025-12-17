import React from "react";
import { CanvasManager } from "@/engine/CanvasManager";

interface BrushSettingsPanelProps {
    engine: CanvasManager;
}

export const BrushSettingsPanel: React.FC<BrushSettingsPanelProps> = ({ engine }) => {
    const [brushSize, setBrushSize] = React.useState(engine.brushSize);

    const panelStyle: React.CSSProperties = {
        background: "#2b2b2b",
        padding: "15px",
        borderBottom: "1px solid #1e1e1e"
    };

    const titleStyle: React.CSSProperties = {
        color: "#cccccc",
        fontSize: "12px",
        fontWeight: "bold",
        marginBottom: "10px",
        textTransform: "uppercase"
    };

    const sliderContainerStyle: React.CSSProperties = {
        marginBottom: "15px"
    };

    const labelStyle: React.CSSProperties = {
        color: "#999",
        fontSize: "11px",
        marginBottom: "5px",
        display: "flex",
        justifyContent: "space-between"
    };

    const sliderStyle: React.CSSProperties = {
        width: "100%",
        height: "4px",
        borderRadius: "2px",
        background: "#1e1e1e",
        outline: "none",
        cursor: "pointer"
    };

    const handleSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newSize = parseInt(e.target.value);
        setBrushSize(newSize);
        engine.brushSize = newSize;
    };

    return (
        <div style={panelStyle}>
            <div style={titleStyle}>Brush Settings</div>

            <div style={sliderContainerStyle}>
                <div style={labelStyle}>
                    <span>Size</span>
                    <span>{brushSize}px</span>
                </div>
                <input
                    type="range"
                    min="1"
                    max="200"
                    value={brushSize}
                    onChange={handleSizeChange}
                    style={sliderStyle}
                />
            </div>

            <div style={sliderContainerStyle}>
                <div style={labelStyle}>
                    <span>Opacity</span>
                    <span>100%</span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="100"
                    defaultValue="100"
                    style={sliderStyle}
                />
            </div>

            <div style={sliderContainerStyle}>
                <div style={labelStyle}>
                    <span>Hardness</span>
                    <span>100%</span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="100"
                    defaultValue="100"
                    style={sliderStyle}
                />
            </div>
        </div>
    );
};
