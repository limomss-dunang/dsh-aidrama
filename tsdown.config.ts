import { defineConfig } from "tsdown";

/**
 * 宿主半构建：DSH 通过 package.json `main` 加载 lib/index.js。
 * 只用 Node 内置模块与 DSH 运行时服务，不打包第三方运行时依赖。
 */
export default defineConfig({
  entry: {
    index: "src/host/index.ts",
  },
  outDir: "lib",
  format: ["esm"],
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    neverBundle: [/^@deepseek-ai\//],
  },
});
