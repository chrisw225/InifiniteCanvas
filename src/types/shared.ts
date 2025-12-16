export interface Point {
  x: number;
  y: number;
}

export interface TileCoord {
  tx: number;
  ty: number;
}

export interface ViewportState {
  x: number; // World x at center of screen (or top-left depending on convention, usually center for infinite canvas)
  y: number;
  zoom: number;
  width: number;
  height: number;
}

export const TILE_SIZE = 256;

export interface Layer {
  id: string; // "layer-0" (background), "layer-1", "layer-2"
  name: string;
  visible: boolean;
  opacity: number;
}

export type BrushType = 'round';

export interface BrushSettings {
  size: number;
  color: string; // Hex
  opacity: number;
  type: BrushType;
}

// Key format: "layerId:tx:ty"
export type TileKey = string;

export function getTileKey(layerId: string, tx: number, ty: number): TileKey {
  return `${layerId}:${tx}:${ty}`;
}
