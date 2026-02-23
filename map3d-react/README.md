# @xwvike/map3d-react

Reusable React 3D map component extracted from the existing project and prepared for npm distribution.

## Install

```bash
npm install @xwvike/map3d-react three d3 gsap
```

## Basic usage

```tsx
import { Map3D } from "@xwvike/map3d-react";

<Map3D
  mode="drilldown"
  dataSource={async ({ adcode, level, signal }) => {
    const suffix = level === "city" || level === "district" ? "_full_district.json" : "_full.json";
    const res = await fetch(`https://web.xtjzx.cn/app/examAnalyze/geojson/${adcode}${suffix}`, { signal });
    return res.json();
  }}
/>;
```

## Exposed ref API

- `addElements(elements)`
- `removeElements(ids)`
- `clearElements()`
- `highlightRegion(regionName, duration?)`
- `clearRegionHighlight(regionName)`
- `clearAllHighlights()`
- `getHighlightedRegions()`
- `drillTo(node)`
- `drillUp()`
- `resetDrilldown()`
- `getDrilldownState()`
