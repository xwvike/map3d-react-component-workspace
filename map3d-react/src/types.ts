import type { Object3D } from "three";

export type MapLevel = "country" | "province" | "city" | "district";

export interface GeoJsonType {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

export interface GeoJsonFeature {
  type: string;
  properties: {
    adcode: number;
    name: string;
    center?: [number, number];
    centroid?: [number, number];
    childrenNum?: number;
    level?: Exclude<MapLevel, "country">;
    parent?: {
      adcode: number;
    };
    subFeatureIndex?: number;
    acroutes?: number[];
    adchar?: unknown;
    [key: string]: unknown;
  };
  geometry: {
    type: GeometryType;
    coordinates: GeometryCoordinates<GeometryType>;
  };
  vector3?: unknown[][];
}

export type GeometryType =
  | "Point"
  | "LineString"
  | "Polygon"
  | "MultiPoint"
  | "MultiLineString"
  | "MultiPolygon"
  | "GeometryCollection";

export type GeometryCoordinates<T extends GeometryType> = T extends "Point"
  ? [number, number]
  : T extends "LineString"
    ? [number, number][]
    : T extends "Polygon"
      ? [number, number][][]
      : T extends "MultiPoint"
        ? [number, number][]
        : T extends "MultiLineString"
          ? [number, number][][]
          : T extends "MultiPolygon"
            ? [number, number][][][]
            : T extends "GeometryCollection"
              ? unknown
              : never;

export interface ExtendObject3D extends Object3D {
  customProperties: GeoJsonFeature["properties"];
}

export type Projection = {
  center: [number, number];
  scale: number;
};

export interface MapElement {
  id: string;
  type: "label" | "spot" | "model" | "line" | "bubble";
  position: [number, number];
  data?: unknown;
}

export interface ModelElement extends MapElement {
  type: "model";
  modelPath: string;
  scale?: [number, number, number];
  animation?: boolean;
}

export interface LineElement extends MapElement {
  type: "line";
  startPosition: [number, number];
  endPosition: [number, number];
}

export interface LabelElement extends MapElement {
  type: "label" | "bubble";
  text: string;
}

export interface SpotElement extends MapElement {
  type: "spot";
  spotData?: unknown;
}

export type AnyMapElement =
  | MapElement
  | ModelElement
  | LineElement
  | LabelElement
  | SpotElement;

export type GeoDataSource = (params: {
  adcode: number;
  level: MapLevel;
  signal: AbortSignal;
}) => Promise<GeoJsonType>;

export interface DrilldownNode {
  adcode: number;
  level: MapLevel;
  name?: string;
  center?: [number, number];
  centroid?: [number, number];
}

export interface DrilldownState {
  path: DrilldownNode[];
  current: DrilldownNode | null;
  loading: boolean;
  error: string | null;
}

export type RegionEventPayload = {
  properties: GeoJsonFeature["properties"];
};
