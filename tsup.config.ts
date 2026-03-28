import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", "bin/apcore-cli": "bin/apcore-cli.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node18",
  outDir: "dist",
  splitting: false,
  shims: true,
});
