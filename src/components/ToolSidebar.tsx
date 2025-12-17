import React from "react";
import { CanvasManager } from "@/engine/CanvasManager";

interface ToolSidebarProps {
    engine: CanvasManager;
}

export const ToolSidebar: React.FC<ToolSidebarProps> = ({ engine }) => {
    const [activeTool, setActiveTool] = React.useState(engine.activeTool);

    React.useEffect(() => {
        const listener = () => setActiveTool(engine.activeTool);
        engine.addListener(listener);
        return () => engine.removeListener(listener);
    }, [engine]);

    const sidebarStyle: React.CSSProperties = {
        width: "50px",
        background: "#2b2b2b",
        borderRight: "1px solid #1e1e1e",
        display: "flex",
        flexDirection: "column",
        padding: "10px 0"
    };

    const toolButtonStyle = (tool: string): React.CSSProperties => ({
        width: "50px",
        height: "50px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        background: activeTool === tool ? "#3a3a3a" : "transparent",
        border: activeTool === tool ? "1px solid #555" : "1px solid transparent",
        color: "#cccccc",
        fontSize: "24px",
        marginBottom: "5px"
    });

    const handleToolClick = (tool: 'brush' | 'eraser') => {
        engine.activeTool = tool;
        engine.notifyListeners();
    };

    return (
        <div style={sidebarStyle}>
            <div
                style={toolButtonStyle('brush')}
                onClick={() => handleToolClick('brush')}
                title="Brush Tool (B)"
            >
                🖌️
            </div>
            <div
                style={toolButtonStyle('eraser')}
                onClick={() => handleToolClick('eraser')}
                title="Eraser Tool (E)"
            >
                🧹
            </div>
            <div
                style={toolButtonStyle('pan')}
                title="Pan Tool (Space)"
            >
                ✋
            </div>
        </div>
    );
};
