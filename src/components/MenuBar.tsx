import React from "react";

interface MenuBarProps {
    onMenuAction?: (action: string) => void;
}

export const MenuBar: React.FC<MenuBarProps> = ({ onMenuAction }) => {
    const menuStyle: React.CSSProperties = {
        height: "30px",
        background: "#2b2b2b",
        borderBottom: "1px solid #1e1e1e",
        display: "flex",
        alignItems: "center",
        padding: "0 10px",
        fontSize: "13px",
        color: "#cccccc",
        userSelect: "none"
    };

    const menuItemStyle: React.CSSProperties = {
        padding: "0 12px",
        cursor: "pointer",
        height: "100%",
        display: "flex",
        alignItems: "center"
    };

    const menuItemHoverStyle: React.CSSProperties = {
        background: "#3a3a3a"
    };

    return (
        <div style={menuStyle}>
            <div style={menuItemStyle}>File</div>
            <div style={menuItemStyle}>Edit</div>
            <div style={menuItemStyle}>View</div>
            <div style={menuItemStyle}>Layer</div>
            <div style={menuItemStyle}>Select</div>
            <div style={menuItemStyle}>Filter</div>
            <div style={menuItemStyle}>Help</div>
        </div>
    );
};
