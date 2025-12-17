import React from "react";
import { CanvasManager } from "@/engine/CanvasManager";

interface ColorPickerPanelProps {
    engine: CanvasManager;
}

export const ColorPickerPanel: React.FC<ColorPickerPanelProps> = ({ engine }) => {
    // Convert RGBA to hex for display
    const rgbaToHex = (rgba: { r: number, g: number, b: number, a: number }) => {
        const r = Math.round(rgba.r * 255).toString(16).padStart(2, '0');
        const g = Math.round(rgba.g * 255).toString(16).padStart(2, '0');
        const b = Math.round(rgba.b * 255).toString(16).padStart(2, '0');
        return `#${r}${g}${b}`;
    };

    const [color, setColor] = React.useState(rgbaToHex(engine.brushColor));

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

    const colorDisplayStyle: React.CSSProperties = {
        width: "100%",
        height: "40px",
        background: color,
        border: "2px solid #1e1e1e",
        borderRadius: "4px",
        marginBottom: "10px"
    };

    const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const hex = e.target.value;
        setColor(hex);

        // Convert hex to RGBA
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        engine.brushColor = { r, g, b, a: 1 };
    };

    return (
        <div style={panelStyle}>
            <div style={titleStyle}>Color</div>
            <div style={colorDisplayStyle} />
            <input
                type="color"
                value={color}
                onChange={handleColorChange}
                style={{ width: "100%", height: "30px", cursor: "pointer" }}
            />
        </div>
    );
};
