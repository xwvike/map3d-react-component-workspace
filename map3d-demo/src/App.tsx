import { useCallback, useRef, useState } from "react";
import {
  Map3D,
  type AnyMapElement,
  type GeoDataSource,
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

const dataSource: GeoDataSource = async ({ adcode, level, signal }) => {
  let suffix = "_full.json";
  if (level === "city" || level === "district") {
    suffix = "_full_district.json";
  }

  const url = `https://web.xtjzx.cn/app/examAnalyze/geojson/${adcode}${suffix}`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch geojson: ${response.status}`);
  }
  return response.json();
};

export default function App() {
  const mapRef = useRef<Map3DRef>(null);
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
          initialNode={{ adcode: 100000, level: "country" }}
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
