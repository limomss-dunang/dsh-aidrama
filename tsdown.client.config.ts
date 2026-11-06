import { defineConfig } from "tsdown";

/**
 * 客户端半构建：DSH Web 通过 `window.__ModuleLoader__.load` 加载 lib/client.js，
 * 因此产物为 CJS，并用 banner/footer 包成 loader 合约。React / react-dom 由
 * 浏览器模块表提供，不打包。
 */

const BUNDLE_ID = "dsh-aidrama";

const banner = `window.__ModuleLoader__.load({
	id: "${BUNDLE_ID}",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });`;

const footer = `		return module.exports;
	}
});`;

export default defineConfig({
  entry: {
    client: "src/client/index.tsx",
  },
  outDir: "lib",
  format: ["cjs"],
  fixedExtension: false,
  outExtensions: () => ({ js: ".js" }),
  banner: { js: banner },
  footer: { js: footer },
  clean: false,
  deps: {
    neverBundle: [/^@deepseek-ai\//, /^react(-dom)?($|\/)/, /^scheduler($|\/)/],
    alwaysBundle: [/^three($|\/)/, /^react-zoom-pan-pinch($|\/)/],
  },
});
