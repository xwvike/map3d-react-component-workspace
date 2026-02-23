export interface MapThemeConfig {
  mapDepth: number;
  mapTransparent: boolean;
  mapOpacity: number;
  mapColor: string;
  mapHoverColor: string;
  mapColorGradient: string[];
  mapSideColor1: string;
  mapSideColor2: string;
  topLineColor: number;
  topLineWidth: number;
  topLineZIndex: number;
  label2dZIndex: number;
  spotZIndex: number;
}

const depth = 5;

export const defaultMapThemeConfig: MapThemeConfig = {
  mapDepth: depth,
  mapTransparent: true,
  mapOpacity: 0.9,
  mapColor: "#06092A",
  mapHoverColor: "#409EF9",
  mapColorGradient: ["#42A0F9", "#1E6BF8", "#0B388A", "#132354"],
  mapSideColor1: "#3F9FF3",
  mapSideColor2: "#266BF0",
  topLineColor: 0x41c0fb,
  topLineWidth: 1,
  topLineZIndex: depth + 0.1,
  label2dZIndex: depth + 1,
  spotZIndex: depth + 0.2,
};

export function mergeThemeConfig(
  overrides?: Partial<MapThemeConfig>
): MapThemeConfig {
  if (!overrides) {
    return defaultMapThemeConfig;
  }

  return {
    ...defaultMapThemeConfig,
    ...overrides,
    mapColorGradient:
      overrides.mapColorGradient ?? defaultMapThemeConfig.mapColorGradient,
  };
}
