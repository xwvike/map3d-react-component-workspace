import * as THREE from "three";
import * as d3 from "d3";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer";
import { Line2 } from "three/examples/jsm/lines/Line2";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial";
import type {
  ExtendObject3D,
  GeoJsonFeature,
  GeoJsonType,
  GeometryCoordinates,
  GeometryType,
  Projection,
} from "../types";
import type { MapThemeConfig } from "./mapConfig";

export function getDynamicMapScale(
  mapObject3D: THREE.Object3D,
  container: HTMLElement
) {
  const width = container.clientWidth;
  const height = container.clientHeight;
  const refArea = width * height;

  const boundingBox = new THREE.Box3().setFromObject(mapObject3D);
  const size = new THREE.Vector3();
  boundingBox.getSize(size);
  const scale = Math.round(Math.sqrt(refArea / (size.x * size.y * 400)));
  return Math.max(scale, 1.2);
}

function drawExtrudeMesh(
  points: [number, number][],
  projectionFn: d3.GeoProjection,
  mapConfig: MapThemeConfig
) {
  const shape = new THREE.Shape();
  const linePoints: number[] = [];

  for (let i = 0; i < points.length; i += 1) {
    const projected = projectionFn(points[i]);
    if (!projected) continue;
    const [x, y] = projected;
    if (i === 0) shape.moveTo(x, -y);
    shape.lineTo(x, -y);
    linePoints.push(x, -y, mapConfig.topLineZIndex);
  }

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: mapConfig.mapDepth,
    bevelEnabled: false,
  });

  const material = new THREE.MeshPhongMaterial({
    color:
      mapConfig.mapColorGradient[
        Math.floor(Math.random() * mapConfig.mapColorGradient.length)
      ] ?? mapConfig.mapColor,
    transparent: mapConfig.mapTransparent,
    opacity: mapConfig.mapOpacity,
  });

  const materialSide = new THREE.ShaderMaterial({
    uniforms: {
      color1: {
        value: new THREE.Color(mapConfig.mapSideColor1),
      },
      color2: {
        value: new THREE.Color(mapConfig.mapSideColor2),
      },
    },
    vertexShader: `
      varying vec3 vPosition;
      void main() {
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 color1;
      uniform vec3 color2;
      varying vec3 vPosition;
      void main() {
        vec3 mixColor = mix(color1, color2, 0.5 - vPosition.z * 0.2);
        gl_FragColor = vec4(mixColor, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, [material, materialSide]);
  mesh.userData = { isChangeColor: true };

  const lineGeometry = new LineGeometry();
  lineGeometry.setPositions(linePoints);

  const lineMaterial = new LineMaterial({
    color: mapConfig.topLineColor,
    linewidth: mapConfig.topLineWidth,
  });
  lineMaterial.resolution.set(window.innerWidth, window.innerHeight);

  const line = new Line2(lineGeometry, lineMaterial);
  return { mesh, line };
}

export function generateMapObject3D(
  mapData: GeoJsonType,
  projection: Projection,
  mapConfig: MapThemeConfig
) {
  const mapObject3D = new THREE.Object3D();
  const { features } = mapData;

  if (!projection.center || projection.center.length !== 2) {
    throw new Error("Invalid projection center");
  }
  if (typeof projection.scale !== "number" || projection.scale <= 0) {
    throw new Error("Invalid projection scale");
  }

  const projectionFn = d3
    .geoMercator()
    .center(projection.center)
    .scale(projection.scale)
    .translate([0, 0]);

  const label2dData: Array<{
    featureCenterCoord: [number, number];
    featureName: string;
  }> = [];

  features.forEach((featureItem: GeoJsonFeature) => {
    const provinceObject = new THREE.Object3D() as ExtendObject3D;
    provinceObject.customProperties = featureItem.properties;

    const featureType = featureItem.geometry.type;
    const featureCoords: GeometryCoordinates<GeometryType> =
      featureItem.geometry.coordinates;
    const center =
      featureItem.properties.centroid && projectionFn(featureItem.properties.centroid);

    if (center) {
      label2dData.push({
        featureCenterCoord: center as [number, number],
        featureName: featureItem.properties.name,
      });
    }

    if (featureType === "MultiPolygon") {
      (featureCoords as [number, number][][][]).forEach(
        (multiPolygon: [number, number][][]) => {
          multiPolygon.forEach((polygon: [number, number][]) => {
            const { mesh, line } = drawExtrudeMesh(polygon, projectionFn, mapConfig);
            provinceObject.add(mesh);
            provinceObject.add(line);
          });
        }
      );
    }

    if (featureType === "Polygon") {
      (featureCoords as [number, number][][]).forEach((polygon: [number, number][]) => {
        const { mesh, line } = drawExtrudeMesh(polygon, projectionFn, mapConfig);
        provinceObject.add(mesh);
        provinceObject.add(line);
      });
    }

    mapObject3D.add(provinceObject);
  });

  return { mapObject3D, label2dData };
}

export function generateElementsData(
  label2dData: Array<{ featureCenterCoord: [number, number]; featureName: string }>
) {
  return label2dData.map((item, index) => ({
    id: `label-${index}`,
    type: "label" as const,
    position: item.featureCenterCoord,
    text: item.featureName.replace("特别行政区", ""),
  }));
}

export function generateLineElementsData(
  label2dData: Array<{ featureCenterCoord: [number, number] }>,
  maxLineCount = 5
) {
  const elements: Array<{
    id: string;
    type: "line";
    position: [number, number];
    startPosition: [number, number];
    endPosition: [number, number];
  }> = [];

  for (let count = 0; count < maxLineCount; count += 1) {
    const midIndex = Math.floor(label2dData.length / 2);
    const indexStart = Math.floor(Math.random() * Math.max(midIndex, 1));
    const indexEnd = Math.floor(Math.random() * Math.max(midIndex, 1)) + midIndex - 1;

    if (indexStart < label2dData.length && indexEnd < label2dData.length && indexEnd >= 0) {
      const start = label2dData[indexStart].featureCenterCoord;
      const end = label2dData[indexEnd].featureCenterCoord;
      elements.push({
        id: `line-${count}`,
        type: "line",
        position: start,
        startPosition: start,
        endPosition: end,
      });
    }
  }

  return elements;
}

export const draw2dLabel = (
  coord: [number, number],
  provinceName: string,
  mapConfig: MapThemeConfig
) => {
  if (!coord?.length) return null;

  const labelDiv = document.createElement("div");
  labelDiv.innerHTML = `<div style="color:#fff;font-size:12px">${provinceName}</div>`;
  labelDiv.style.pointerEvents = "none";

  const labelObject = new CSS2DObject(labelDiv);
  labelObject.position.set(coord[0], -coord[1], mapConfig.label2dZIndex);
  return labelObject;
};

export const draw2dBubble = (
  coord: [number, number],
  text: string,
  mapConfig: MapThemeConfig,
  options?: {
    bgColor?: string;
    textColor?: string;
    borderColor?: string;
    fontSize?: number;
  }
) => {
  if (!coord?.length) return null;

  const {
    bgColor = "#1a1a1a",
    textColor = "#ffffff",
    borderColor = "#00d4ff",
    fontSize = 12,
  } = options ?? {};

  const bubbleDiv = document.createElement("div");
  bubbleDiv.style.position = "relative";
  bubbleDiv.style.pointerEvents = "none";
  bubbleDiv.style.filter = "drop-shadow(0 4px 8px rgba(0, 212, 255, 0.3))";
  bubbleDiv.innerHTML = `
    <div style="position: relative; display: inline-block;">
      <svg width="120" height="36" viewBox="0 0 120 36" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bubbleGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:${bgColor};stop-opacity:0.9" />
            <stop offset="100%" style="stop-color:${bgColor};stop-opacity:0.7" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="116" height="24" rx="12" ry="12" fill="url(#bubbleGradient)" stroke="${borderColor}" stroke-width="1"/>
      </svg>
      <div style="
        position:absolute;
        top:2px;
        left:2px;
        width:116px;
        height:24px;
        display:flex;
        align-items:center;
        justify-content:center;
        color:${textColor};
        font-size:${fontSize}px;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
        padding:0 8px;
        box-sizing:border-box;
      ">${text}</div>
    </div>
  `;

  const bubbleObject = new CSS2DObject(bubbleDiv);
  bubbleObject.position.set(coord[0], -coord[1], mapConfig.label2dZIndex + 1);
  return bubbleObject;
};

export const drawSpot = (coord: [number, number], mapConfig: MapThemeConfig) => {
  if (!coord?.length) return null;

  const spotGeometry = new THREE.CircleGeometry(0.2, 200);
  const spotMaterial = new THREE.MeshBasicMaterial({
    color: "#3EC5FB",
    side: THREE.DoubleSide,
  });
  const circle = new THREE.Mesh(spotGeometry, spotMaterial);
  circle.position.set(coord[0], -coord[1], mapConfig.spotZIndex);

  const ringGeometry = new THREE.RingGeometry(0.2, 0.3, 50);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: "#3FC5FB",
    side: THREE.DoubleSide,
    transparent: true,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial) as THREE.Mesh & { _s?: number };
  ring.position.set(coord[0], -coord[1], mapConfig.spotZIndex);
  ring._s = 1;
  return { circle, ring };
};

export const drawFlySpot = (curve: THREE.QuadraticBezierCurve3) => {
  const geometry = new THREE.SphereGeometry(0.2);
  const material = new THREE.MeshBasicMaterial({
    color: "#77f077",
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material) as THREE.Mesh & {
    curve?: THREE.QuadraticBezierCurve3;
    _s?: number;
  };
  mesh.curve = curve;
  mesh._s = 0;
  return mesh;
};

export const drawLineBetween2Spot = (
  coordStart: [number, number],
  coordEnd: [number, number],
  mapConfig: MapThemeConfig
) => {
  const [x0, y0, z0] = [...coordStart, mapConfig.spotZIndex];
  const [x1, y1, z1] = [...coordEnd, mapConfig.spotZIndex];

  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(x0, -y0, z0),
    new THREE.Vector3((x0 + x1) / 2, -(y0 + y1) / 2, 20),
    new THREE.Vector3(x1, -y1, z1)
  );

  const flySpot = drawFlySpot(curve);
  const lineGeometry = new THREE.BufferGeometry();
  const points = curve.getPoints(50);
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();

  for (let i = 0; i < points.length; i += 1) {
    color.setHSL(0.21 + i, 0.77, 0.55 + i * 0.0025);
    colors.push(color.r, color.g, color.b);
    positions.push(points[i].x, points[i].y, points[i].z);
  }

  lineGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(positions), 3, true)
  );
  lineGeometry.setAttribute(
    "color",
    new THREE.BufferAttribute(new Float32Array(colors), 3, true)
  );

  const lineMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });

  const flyLine = new THREE.Line(lineGeometry, lineMaterial);
  return { flyLine, flySpot };
};
