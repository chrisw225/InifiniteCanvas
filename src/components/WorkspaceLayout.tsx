"use client";

import React, { useRef } from "react";
import DockLayout, { LayoutData } from "rc-dock";
import "rc-dock/dist/rc-dock.css";
import "./dock-theme.css";
import { CanvasManager } from "@/engine/CanvasManager";
import { CanvasPanel } from "./CanvasPanel";

export const WorkspaceLayout: React.FC = () => {
    const dockRef = useRef<DockLayout>(null);

    // Default Layout Configuration
    const defaultLayout: LayoutData = {
        dockbox: {
            mode: "horizontal",
            children: [
                {
                    mode: "vertical",
                    size: 250,
                    children: [
                        {
                            tabs: [
                                {
                                    id: "layers",
                                    title: "Layers",
                                    content: <div className="p-4 text-white">Layers Panel</div>,
                                }
                            ]
                        }
                    ]
                },
                {
                    id: "canvas-area",
                    size: 10000, // Much larger to take most of the space
                    tabs: [
                        {
                            id: "canvas",
                            title: "Canvas",
                            content: <CanvasPanel />,
                        }
                    ]
                },
                {
                    size: 300,
                    tabs: [
                        {
                            id: "tools",
                            title: "Tools",
                            content: <div className="p-4 text-white">Tools Panel</div>,
                            cached: true
                        }
                    ]
                }
            ]
        }
    };

    return (
        <div className="w-full h-screen bg-gray-800 text-white">
            <DockLayout
                ref={dockRef}
                defaultLayout={defaultLayout}
                style={{
                    width: "100%",
                    height: "100%",
                }}
            />
        </div>
    );
};
