import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import * as d3 from "d3";
import gsap from "gsap";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { initScene } from "../core/scene";
import { initCamera } from "../core/camera";
import {
  generateElementsData,
  generateLineElementsData,
  generateMapObject3D,
  getDynamicMapScale,
} from "../core/draw";
import { MapManager } from "../core/mapManager";
import {
  defaultMapThemeConfig,
  mergeThemeConfig,
  type MapThemeConfig,
} from "../core/mapConfig";
import type {
  AnyMapElement,
  DrilldownNode,
  DrilldownState,
  GeoDataSource,
  GeoJsonFeature,
  GeoJsonType,
  MapLevel,
  Projection,
  RegionEventPayload,
} from "../types";

type InteractionConfig = {
  enableHover?: boolean;
  enableDoubleClick?: boolean;
};

type AssetConfig = {
  dracoDecoderPath?: string;
};

const DEFAULT_PROJECTION: Projection = {
  center: [104.0, 37.5],
  scale: 40,
};

const LEVEL_SCALE: Record<Exclude<MapLevel, "country">, number> = {
  province: 100,
  city: 220,
  district: 320,
};

function resolveNodeProjection(node: DrilldownNode, baseProjection: Projection): Projection {
  if (node.level === "country") {
    return baseProjection;
  }

  const center = node.centroid ?? node.center ?? baseProjection.center;
  const scale = LEVEL_SCALE[node.level] ?? baseProjection.scale;
  return { center, scale };
}

function nextLevel(level: MapLevel): MapLevel | null {
  if (level === "country") return "province";
  if (level === "province") return "city";
  if (level === "city") return "district";
  return null;
}

function keyOf(level: MapLevel, adcode: number) {
  return `${level}:${adcode}`;
}

export interface Map3DProps {
  geoJson?: GeoJsonType;
  mode?: "static" | "drilldown";
  dataSource?: GeoDataSource;
  initialNode?: DrilldownNode;
  projection?: Projection;
  autoFitOnDrilldown?: boolean;
  className?: string;
  style?: React.CSSProperties;
  themeConfig?: Partial<MapThemeConfig>;
  assetConfig?: AssetConfig;
  interactionConfig?: InteractionConfig;
  defaultLineCount?: number;
  onRegionHover?: (payload: RegionEventPayload | null) => void;
  onRegionDoubleClick?: (payload: RegionEventPayload) => void;
  onError?: (error: Error) => void;
  onReady?: () => void;
  onDrilldownChange?: (state: DrilldownState) => void;
}

export interface Map3DRef {
  addElements: (elements: AnyMapElement[]) => Promise<void>;
  removeElements: (ids: string[]) => void;
  clearElements: () => void;
  highlightRegion: (regionName: string, duration?: number) => boolean;
  clearRegionHighlight: (regionName: string) => boolean;
  clearAllHighlights: () => void;
  getHighlightedRegions: () => string[];
  drillTo: (node: DrilldownNode) => Promise<void>;
  drillUp: () => Promise<void>;
  resetDrilldown: () => Promise<void>;
  getDrilldownState: () => DrilldownState;
}

export const Map3D = forwardRef<Map3DRef, Map3DProps>((props, ref) => {
  const {
    geoJson,
    mode = "static",
    dataSource,
    initialNode = { adcode: 100000, level: "country" },
    projection,
    autoFitOnDrilldown = true,
    className,
    style,
    themeConfig,
    assetConfig,
    interactionConfig,
    defaultLineCount = 0,
    onRegionHover,
    onRegionDoubleClick,
    onError,
    onReady,
    onDrilldownChange,
  } = props;

  const mergedTheme = useMemo(() => mergeThemeConfig(themeConfig), [themeConfig]);
  const initialNodeStable = useMemo(
    () => initialNode,
    [initialNode.adcode, initialNode.level]
  );
  const interactive = useMemo(
    () => ({
      enableHover: Boolean(interactionConfig?.enableHover),
      enableDoubleClick: interactionConfig?.enableDoubleClick ?? true,
    }),
    [interactionConfig]
  );

  const mapRef = useRef<HTMLDivElement>(null);
  const map2dRef = useRef<HTMLDivElement>(null);
  const mapManagerRef = useRef<MapManager | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const labelRendererRef = useRef<CSS2DRenderer | null>(null);
  const mapObjectRef = useRef<THREE.Object3D | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rafRef = useRef<number | null>(null);
  const raycasterRef = useRef<THREE.Raycaster | null>(null);
  const pointerRef = useRef(new THREE.Vector2());
  const lastPickRef = useRef<THREE.Intersection | null>(null);
  const cacheRef = useRef<Map<string, GeoJsonType>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const pathRef = useRef<DrilldownNode[]>([initialNodeStable]);
  const drilldownStateRef = useRef<DrilldownState>({
    path: [initialNodeStable],
    current: initialNodeStable,
    loading: false,
    error: null,
  });
  const projectionRef = useRef<Projection>(projection ?? DEFAULT_PROJECTION);
  const onRegionHoverRef = useRef<Map3DProps["onRegionHover"]>(onRegionHover);
  const onRegionDoubleClickRef = useRef<Map3DProps["onRegionDoubleClick"]>(
    onRegionDoubleClick
  );
  const onErrorRef = useRef<Map3DProps["onError"]>(onError);
  const onReadyRef = useRef<Map3DProps["onReady"]>(onReady);
  const onDrilldownChangeRef = useRef<Map3DProps["onDrilldownChange"]>(
    onDrilldownChange
  );

  const [resolvedGeoJson, setResolvedGeoJson] = useState<GeoJsonType | undefined>(geoJson);

  useEffect(() => {
    onRegionHoverRef.current = onRegionHover;
    onRegionDoubleClickRef.current = onRegionDoubleClick;
    onErrorRef.current = onError;
    onReadyRef.current = onReady;
    onDrilldownChangeRef.current = onDrilldownChange;
  }, [onRegionHover, onRegionDoubleClick, onError, onReady, onDrilldownChange]);

  const emitDrilldown = useCallback((partial?: Partial<DrilldownState>) => {
    drilldownStateRef.current = {
      ...drilldownStateRef.current,
      ...partial,
      path: partial?.path ?? pathRef.current,
      current:
        partial && "current" in partial
          ? partial.current ?? null
          : pathRef.current[pathRef.current.length - 1] ?? null,
    };
    onDrilldownChangeRef.current?.(drilldownStateRef.current);
  }, []);

  const resetHoveredRegionColor = useCallback(() => {
    const lastPick = lastPickRef.current;
    if (!lastPick) return;
    const material = (lastPick.object as THREE.Mesh).material;
    const randomColor =
      mergedTheme.mapColorGradient[
        Math.floor(Math.random() * mergedTheme.mapColorGradient.length)
      ] ?? defaultMapThemeConfig.mapColor;

    if (Array.isArray(material) && material[0] instanceof THREE.MeshPhongMaterial) {
      material[0].color.set(randomColor);
      material[0].opacity = mergedTheme.mapOpacity;
    }
  }, [mergedTheme.mapColorGradient, mergedTheme.mapOpacity]);

  const applyHoverColor = useCallback((target: THREE.Intersection) => {
    const material = (target.object as THREE.Mesh).material;
    if (Array.isArray(material) && material[0] instanceof THREE.MeshPhongMaterial) {
      material[0].color.set(mergedTheme.mapHoverColor);
      material[0].opacity = 1;
    }
  }, [mergedTheme.mapHoverColor]);

  const destroyRuntime = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    controlsRef.current?.dispose();
    controlsRef.current = null;

    mapManagerRef.current?.dispose();
    mapManagerRef.current = null;

    rendererRef.current?.dispose();
    rendererRef.current = null;

    if (mapRef.current && mapRef.current.firstChild) {
      mapRef.current.removeChild(mapRef.current.firstChild);
    }

    if (map2dRef.current && map2dRef.current.firstChild) {
      map2dRef.current.removeChild(map2dRef.current.firstChild);
    }

    sceneRef.current = null;
    cameraRef.current = null;
    labelRendererRef.current = null;
    mapObjectRef.current = null;
    raycasterRef.current = null;
    lastPickRef.current = null;
  }, []);

  const loadFromDataSource = useCallback(
    async (node: DrilldownNode) => {
      if (!dataSource) {
        throw new Error("mode=drilldown requires dataSource");
      }

      const cacheKey = keyOf(node.level, node.adcode);
      const cached = cacheRef.current.get(cacheKey);
      if (cached) {
        setResolvedGeoJson(cached);
        emitDrilldown({ loading: false, error: null, current: node });
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      emitDrilldown({ loading: true, error: null, current: node });

      try {
        const loaded = await dataSource({
          adcode: node.adcode,
          level: node.level,
          signal: controller.signal,
        });
        cacheRef.current.set(cacheKey, loaded);
        setResolvedGeoJson(loaded);
        emitDrilldown({ loading: false, error: null, current: node });
      } catch (error) {
        if (controller.signal.aborted) return;
        const err = error instanceof Error ? error : new Error(String(error));
        emitDrilldown({ loading: false, error: err.message, current: node });
        onErrorRef.current?.(err);
      }
    },
    [dataSource, emitDrilldown]
  );

  const updateProjectionFromFeature = useCallback((feature: GeoJsonFeature["properties"]) => {
    if (!autoFitOnDrilldown) return;
    const center = feature.centroid ?? feature.center;
    if (!center) return;
    const level = feature.level ?? "province";
    const scale = LEVEL_SCALE[level] ?? DEFAULT_PROJECTION.scale;
    projectionRef.current = {
      center,
      scale,
    };
  }, [autoFitOnDrilldown]);

  const drillTo = useCallback(
    async (node: DrilldownNode) => {
      if (mode !== "drilldown") return;
      const baseProjection = projection ?? DEFAULT_PROJECTION;
      projectionRef.current = resolveNodeProjection(node, baseProjection);
      const nextPath = [...pathRef.current, node];
      pathRef.current = nextPath;
      emitDrilldown({ path: nextPath, current: node });
      await loadFromDataSource(node);
    },
    [emitDrilldown, loadFromDataSource, mode, projection]
  );

  const drillUp = useCallback(async () => {
    if (mode !== "drilldown") return;
    if (pathRef.current.length <= 1) return;

    const nextPath = pathRef.current.slice(0, -1);
    pathRef.current = nextPath;
    const current = nextPath[nextPath.length - 1];
    const baseProjection = projection ?? DEFAULT_PROJECTION;
    projectionRef.current = resolveNodeProjection(current, baseProjection);
    emitDrilldown({ path: nextPath, current });
    await loadFromDataSource(current);
  }, [emitDrilldown, loadFromDataSource, mode, projection]);

  const resetDrilldown = useCallback(async () => {
    if (mode !== "drilldown") return;
    pathRef.current = [initialNodeStable];
    emitDrilldown({ path: [initialNodeStable], current: initialNodeStable, error: null });
    projectionRef.current = resolveNodeProjection(
      initialNodeStable,
      projection ?? DEFAULT_PROJECTION
    );
    await loadFromDataSource(initialNodeStable);
  }, [emitDrilldown, initialNodeStable, loadFromDataSource, mode, projection]);

  useEffect(() => {
    if (mode === "static") {
      setResolvedGeoJson(geoJson);
      projectionRef.current = resolveNodeProjection(
        initialNodeStable,
        projection ?? DEFAULT_PROJECTION
      );
      return;
    }

    projectionRef.current = resolveNodeProjection(
      initialNodeStable,
      projection ?? DEFAULT_PROJECTION
    );
    pathRef.current = [initialNodeStable];
    emitDrilldown({ path: [initialNodeStable], current: initialNodeStable, error: null });
    void loadFromDataSource(initialNodeStable);
  }, [emitDrilldown, geoJson, initialNodeStable, loadFromDataSource, mode, projection]);

  useEffect(() => {
    const container = mapRef.current;
    if (!container || !resolvedGeoJson) return;

    destroyRuntime();

    let mounted = true;
    const ratio = { value: 0 };

    const scene = initScene();
    sceneRef.current = scene;

    const { camera } = initCamera(container);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(container.clientWidth, container.clientHeight);
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(container.clientWidth, container.clientHeight);
    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.top = "0";
    labelRenderer.domElement.style.left = "0";
    labelRenderer.domElement.style.pointerEvents = "none";
    labelRendererRef.current = labelRenderer;
    map2dRef.current?.appendChild(labelRenderer.domElement);

    let mapObject3D: THREE.Object3D;
    let label2dData: ReturnType<typeof generateMapObject3D>["label2dData"];
    try {
      const generated = generateMapObject3D(
        resolvedGeoJson,
        projectionRef.current,
        mergedTheme
      );
      mapObject3D = generated.mapObject3D;
      label2dData = generated.label2dData;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      onErrorRef.current?.(err);
      return;
    }

    mapObjectRef.current = mapObject3D;
    scene.add(mapObject3D);

    const mapManager = new MapManager(scene, mapObject3D, {
      dracoDecoderPath: assetConfig?.dracoDecoderPath,
      themeConfig: mergedTheme,
    });
    mapManagerRef.current = mapManager;

    const mapScale = getDynamicMapScale(mapObject3D, container);

    void mapManager
      .addElements([
        ...generateElementsData(label2dData),
        ...generateLineElementsData(label2dData, defaultLineCount),
      ])
      .catch((error) => {
        const err = error instanceof Error ? error : new Error(String(error));
        onErrorRef.current?.(err);
      });

    controlsRef.current = new OrbitControls(camera, container);

    const light = new THREE.PointLight(0xffffff, 1.5);
    light.position.set(0, -5, 30);
    scene.add(light);

    const raycaster = new THREE.Raycaster();
    raycasterRef.current = raycaster;

    const onResize = () => {
      if (!container || !rendererRef.current || !labelRendererRef.current || !cameraRef.current) {
        return;
      }

      cameraRef.current.aspect = container.clientWidth / container.clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(container.clientWidth, container.clientHeight);
      rendererRef.current.setPixelRatio(window.devicePixelRatio);
      labelRendererRef.current.setSize(container.clientWidth, container.clientHeight);
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!interactive.enableHover || !raycasterRef.current || !cameraRef.current) return;

      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      pointerRef.current.x = (x / rect.width) * 2 - 1;
      pointerRef.current.y = -(y / rect.height) * 2 + 1;

      resetHoveredRegionColor();
      lastPickRef.current = null;

      const intersects = raycasterRef.current.intersectObjects(scene.children, true);
      const pick = intersects.find((item) => item.object.userData.isChangeColor);
      if (!pick) {
        onRegionHoverRef.current?.(null);
        return;
      }

      lastPickRef.current = pick;
      applyHoverColor(pick);

      const propsData = ((pick.object.parent as THREE.Object3D & { customProperties?: GeoJsonFeature["properties"] })
        .customProperties ?? {}) as GeoJsonFeature["properties"];
      onRegionHoverRef.current?.({ properties: propsData });
    };

    const onDblClick = (event: MouseEvent) => {
      if (!interactive.enableDoubleClick || !raycasterRef.current || !cameraRef.current) return;

      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      pointerRef.current.x = (x / rect.width) * 2 - 1;
      pointerRef.current.y = -(y / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(pointerRef.current, cameraRef.current);

      const intersects = raycasterRef.current.intersectObjects(scene.children, true);
      const target = intersects.find((item) => item.object.userData.isChangeColor);
      if (!target) return;

      const propsData = ((target.object.parent as THREE.Object3D & { customProperties?: GeoJsonFeature["properties"] })
        .customProperties ?? {}) as GeoJsonFeature["properties"];

      const payload = { properties: propsData };
      onRegionDoubleClickRef.current?.(payload);

      if (mode === "drilldown") {
        const current = pathRef.current[pathRef.current.length - 1];
        const next = nextLevel(current.level);
        if (next && propsData.adcode) {
          updateProjectionFromFeature(propsData);
          void drillTo({
            adcode: Number(propsData.adcode),
            level: next,
            name: String(propsData.name ?? ""),
            center: propsData.center,
            centroid: propsData.centroid,
          });
        }
      }
    };

    gsap.to(mapObject3D.scale, { x: mapScale, y: mapScale, z: 1, duration: 1 });

    const clock = new THREE.Clock();
    const animate = () => {
      if (!mounted || !rendererRef.current || !labelRendererRef.current || !cameraRef.current) {
        return;
      }

      const delta = clock.getDelta();
      mapManager.updateAnimations(delta);
      ratio.value += 0.01;

      raycaster.setFromCamera(pointerRef.current, cameraRef.current);
      rendererRef.current.render(scene, cameraRef.current);
      labelRendererRef.current.render(scene, cameraRef.current);
      rafRef.current = requestAnimationFrame(animate);
    };
    animate();

    container.addEventListener("mousemove", onMouseMove);
    container.addEventListener("dblclick", onDblClick);
    window.addEventListener("resize", onResize);

    onReadyRef.current?.();

    return () => {
      mounted = false;
      container.removeEventListener("mousemove", onMouseMove);
      container.removeEventListener("dblclick", onDblClick);
      window.removeEventListener("resize", onResize);
      destroyRuntime();
    };
  }, [
    applyHoverColor,
    assetConfig?.dracoDecoderPath,
    defaultLineCount,
    destroyRuntime,
    drillTo,
    interactive.enableDoubleClick,
    interactive.enableHover,
    mergedTheme,
    mode,
    resetHoveredRegionColor,
    resolvedGeoJson,
    updateProjectionFromFeature,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      addElements: async (elements) => {
        if (!mapManagerRef.current) return;
        await mapManagerRef.current.addElements(elements);
      },
      removeElements: (ids) => {
        mapManagerRef.current?.removeElements(ids);
      },
      clearElements: () => {
        mapManagerRef.current?.clearAllElements();
      },
      highlightRegion: (regionName, duration) => {
        return mapManagerRef.current?.highlightRegion(regionName, duration) ?? false;
      },
      clearRegionHighlight: (regionName) => {
        return mapManagerRef.current?.clearRegionHighlight(regionName) ?? false;
      },
      clearAllHighlights: () => {
        mapManagerRef.current?.clearAllHighlights();
      },
      getHighlightedRegions: () => {
        return mapManagerRef.current?.getHighlightedRegions() ?? [];
      },
      drillTo,
      drillUp,
      resetDrilldown,
      getDrilldownState: () => drilldownStateRef.current,
    }),
    [drillTo, drillUp, resetDrilldown]
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      destroyRuntime();
    };
  }, [destroyRuntime]);

  return (
    <div
      className={className}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        position: "relative",
        ...style,
      }}
    >
      <div
        ref={mapRef}
        style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
      />
      <div
        ref={map2dRef}
        style={{
          width: "100%",
          height: "100%",
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
        }}
      />
    </div>
  );
});

Map3D.displayName = "Map3D";
