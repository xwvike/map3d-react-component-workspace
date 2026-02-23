import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  external: ["react", "react-dom", "three", "d3", "gsap"],
  minify: false,
  treeshake: true,
});
