import { useCallback, useMemo, useRef, useState } from "react";
import {
  Map3D,
  type AnyMapElement,
  type GeoDataSource,
  type GeoJsonType,
  type Map3DRef,
  type MapLevel,
  type RegionEventPayload,
} from "@xtjzx/map3d-react";

const levelScale: Record<MapLevel, number> = {
  country: 40,
  province: 100,
  city: 220,
  district: 320,
};

function normalizeAdcode(value: number) {
  const text = String(Math.trunc(value)).padStart(6, "0").slice(0, 6);
  return Number(text);
}

function getProvinceAdcode(value: number) {
  const adcode = normalizeAdcode(value);
  return Math.floor(adcode / 10000) * 10000;
}

async function fetchFirstGeoJson(urls: string[], signal: AbortSignal) {
  for (const url of urls) {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      continue;
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("json")) {
      continue;
    }

    try {
      return await response.json();
    } catch {
      // 某些 dev server 在缺失静态文件时会返回 HTML 回退页，这里跳过继续尝试下一个候选 URL。
      continue;
    }
  }
  throw new Error(`GeoJSON not found. Tried: ${urls.join(", ")}`);
}

function filterGeoJsonByAdcode(geoJson: GeoJsonType, adcode: number) {
  const features = geoJson.features.filter((feature) => feature.properties.adcode === adcode);
  return { ...geoJson, features };
}

function filterGeoJsonByParentAdcode(geoJson: GeoJsonType, parentAdcode: number) {
  const features = geoJson.features.filter((feature) => {
    const parent = feature.properties.parent;
    return parent?.adcode === parentAdcode;
  });
  return { ...geoJson, features };
}

function getFeatureLevel(value: unknown): MapLevel | null {
  if (
    value === "country" ||
    value === "province" ||
    value === "city" ||
    value === "district"
  ) {
    return value;
  }
  return null;
}

const dataSource: GeoDataSource = async ({ adcode, level, signal }) => {
  const safeAdcode = normalizeAdcode(adcode);
  const provinceAdcode = getProvinceAdcode(safeAdcode);

  if (level === "country") {
    return fetchFirstGeoJson(
      ["/geojson/100000_full.json", "/geojson/100000_full_city.json", "/geojson/cn.geojson"],
      signal
    );
  }

  if (level === "province") {
    return fetchFirstGeoJson(
      [`/geojson/${safeAdcode}_full.json`, `/geojson/${safeAdcode}.json`],
      signal
    );
  }

  if (level === "city") {
    const cityGeoJson = await fetchFirstGeoJson(
      [
        `/geojson/${safeAdcode}_full_district.json`,
        `/geojson/${provinceAdcode}_full_district.json`,
        `/geojson/${safeAdcode}_full.json`,
        `/geojson/${safeAdcode}.json`,
      ],
      signal
    );

    const filteredByParent = filterGeoJsonByParentAdcode(cityGeoJson, safeAdcode);
    if (filteredByParent.features.length > 0) {
      return filteredByParent;
    }

    return cityGeoJson;
  }

  const districtGeoJson = await fetchFirstGeoJson(
    [
      `/geojson/${safeAdcode}_full_district.json`,
      `/geojson/${provinceAdcode}_full_district.json`,
      `/geojson/${safeAdcode}_full.json`,
      `/geojson/${safeAdcode}.json`,
      `/geojson/${provinceAdcode}.json`,
    ],
    signal
  );

  const exactDistrict = filterGeoJsonByAdcode(districtGeoJson, safeAdcode);
  if (exactDistrict.features.length > 0) {
    return exactDistrict;
  }

  const districtByParent = filterGeoJsonByParentAdcode(districtGeoJson, safeAdcode);
  if (districtByParent.features.length > 0) {
    return districtByParent;
  }

  return districtGeoJson;
};

export default function App() {
  const mapRef = useRef<Map3DRef>(null);
  const initialNode = useMemo(() => ({ adcode: 100000, level: "country" as const }), []);
  const drilldownConfig = useMemo(
    () => ({
      autoDrilldownOnDoubleClick: true,
      getNextLevel: (
        current: { level: MapLevel },
        payload: { properties: Record<string, unknown> }
      ) => {
        const featureLevel = getFeatureLevel(payload.properties.level);

        // 直辖市（如北京/上海/天津/重庆）在省级数据里通常直接就是 district，
        // 这时不再强制走 province -> city -> district 三层链路，避免错误下钻。
        if (current.level === "province" && featureLevel === "district") {
          return null;
        }

        if (current.level === "country") return "province";
        if (current.level === "province") return "city";
        if (current.level === "city") return "district";
        return null;
      },
    }),
    []
  );
  const [hoverRegion, setHoverRegion] = useState("-");
  const [drillPathText, setDrillPathText] = useState("100000(country)");
  const [eventLog, setEventLog] = useState<string[]>([]);

  const appendLog = useCallback((line: string) => {
    setEventLog((prev) => [line, ...prev].slice(0, 8));
  }, []);

  const addRandomSpot = useCallback(async () => {
    const x = Math.random() * 60 - 30;
    const y = Math.random() * 40 - 20;
    const id = `demo-spot-${Date.now()}`;
    const elements: AnyMapElement[] = [
      {
        id: `${id}-bubble`,
        type: "bubble",
        position: [x, y],
        text: "Demo +1",
      },
      {
        id: `${id}-spot`,
        type: "spot",
        position: [x, y],
      },
    ];
    await mapRef.current?.addElements(elements);
    appendLog(`addElements: ${id}`);
  }, [appendLog]);

  const clearDynamicElements = useCallback(() => {
    mapRef.current?.clearElements();
    appendLog("clearElements");
  }, [appendLog]);

  const highlightGuangdong = useCallback(() => {
    const ok = mapRef.current?.highlightRegion("广东省", 3000);
    appendLog(`highlightRegion(广东省): ${ok ? "ok" : "miss"}`);
  }, [appendLog]);

  const drillUp = useCallback(async () => {
    await mapRef.current?.drillUp();
    const state = mapRef.current?.getDrilldownState();
    if (state) {
      setDrillPathText(state.path.map((n) => `${n.adcode}(${n.level})`).join(" -> "));
    }
  }, []);

  const resetDrilldown = useCallback(async () => {
    await mapRef.current?.resetDrilldown();
    const state = mapRef.current?.getDrilldownState();
    if (state) {
      setDrillPathText(state.path.map((n) => `${n.adcode}(${n.level})`).join(" -> "));
    }
  }, []);

  const handleDoubleClick = useCallback(
    (payload: RegionEventPayload) => {
      const name = String(payload.properties.name ?? "unknown");
      const level = (payload.properties.level as MapLevel | undefined) ?? "province";
      appendLog(`dblclick: ${name} (${level})`);
    },
    [appendLog]
  );

  return (
    <div className="page">
      <aside className="panel">
        <h1>Map3D npm 组件验收页</h1>
        <p>操作说明：双击地图区域下钻；点击按钮验证 ref API。</p>

        <div className="group">
          <button onClick={addRandomSpot}>添加随机点位</button>
          <button onClick={highlightGuangdong}>高亮广东省</button>
          <button onClick={clearDynamicElements}>清空动态元素</button>
        </div>

        <div className="group">
          <button onClick={drillUp}>上钻一级</button>
          <button onClick={resetDrilldown}>回到国家级</button>
        </div>

        <div className="status">
          <div>当前 hover: {hoverRegion}</div>
          <div>下钻路径: {drillPathText}</div>
          <div>推荐缩放: country={levelScale.country} / province={levelScale.province} / city={levelScale.city} / district={levelScale.district}</div>
        </div>

        <div className="log">
          {eventLog.map((item, index) => (
            <div key={`${index}-${item}`}>{item}</div>
          ))}
        </div>
      </aside>

      <main className="stage">
        <Map3D
          ref={mapRef}
          mode="drilldown"
          dataSource={dataSource}
          initialNode={initialNode}
          drilldownConfig={drilldownConfig}
          style={{ width: "100%", height: "100%" }}
          assetConfig={{ dracoDecoderPath: "/draco/" }}
          interactionConfig={{ enableHover: true, enableDoubleClick: true }}
          onRegionHover={(payload) => {
            setHoverRegion(payload?.properties?.name ? String(payload.properties.name) : "-");
          }}
          onRegionDoubleClick={handleDoubleClick}
          onDrilldownChange={(state) => {
            setDrillPathText(state.path.map((n) => `${n.adcode}(${n.level})`).join(" -> "));
          }}
          onError={(error) => {
            appendLog(`error: ${error.message}`);
          }}
          onReady={() => {
            appendLog("map ready");
          }}
        />
      </main>
    </div>
  );
}
