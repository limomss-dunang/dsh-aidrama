# Contributing / 贡献指南

感谢改进 dsh-aidrama。这是 DeepSeek Harness 的侧边栏工作台插件：宿主半边（Node / Cordis）负责项目状态、编译与校验，浏览器半边（React）负责制片台界面。

## 环境要求

- Node.js **22+**
- 可选：`ffmpeg`（分镜视频与音频处理相关功能；核心的编译/校验链路不需要）

## 本地开发

```bash
npm install            # 安装依赖；prepare 会自动构建 lib/
npm run build          # 单独重新构建：lib/index.js（宿主）+ lib/client.js（浏览器）
npm run typecheck      # tsc --noEmit
```

`lib/` 不提交进仓库，由 `npm install`（`prepare`）或 `npm run build` 生成。

### 冒烟与测试脚本

`scripts/` 下有两类脚本，都能在真实宿主上跑：

| 脚本 | 用途 |
|---|---|
| `node scripts/smoke.mjs <sessionId>` | 通过本机桥接路由跑「建项目 → 存结构 → 编译 → 校验 → 导出 → 删除」，**不调用模型** |
| `node scripts/dom-test.mjs` | 客户端渲染相关检查 |
| `node scripts/check-project.mjs <projectId>` | 校验一个已有项目的结构与引用 |
| `scripts/real-*.mjs` | 真实链路调试脚本（会调用模型/生图，谨慎使用，会消耗额度） |

冒烟脚本默认连 `http://127.0.0.1:51469`，可用 `DSH_WEB_URL` 覆盖。

## 代码结构

```
src/shared/     宿主与浏览器共用的类型、ID 规则、校验规则
src/host/       插件入口、项目存储、编译与校验、桥接路由、模型适配
src/client/     制片台界面（总纲 / 资产 / 分集 / 分镜 / 提示词 / 台账 / 质检）
docs/           设计文档、审查清单、TTS 与模型配置调研
scripts/        构建、冒烟、调试脚本
```

约定：

- 宿主半边只用 Node 内置模块 + 原生 `fetch`，不引入新的运行时依赖（客户端打包的 `three` / `react-zoom-pan-pinch` 除外，它们由构建内联）；
- React / react-dom / scheduler 由 DSH 浏览器模块表提供，不打包；
- 项目状态一律写 `project.json`，导出 Markdown 只是视图。

## 提交前

```bash
npm run typecheck && npm run build
```

CI 会跑同样的两件事。

## 提交 PR

- 一个 PR 只做一件事；修 bug 附复现步骤（项目 JSON 片段、校验报错、日志）。
- 改校验规则（`src/host/validate*.ts` 一类）时，请说明新增/放宽的是哪条规则、为什么，以及受影响的既有项目要不要迁移。
- 提交信息用 `feat: / fix: / docs: / chore:` 前缀。
- 不要提交真实密钥、`project.json`、生成图片与视频（`.gitignore` 已排除 `lib/`、`output/`、`research/`、`node_modules/`）。

## 发版

```bash
npm run build && npm run typecheck
git add -A && git commit -m "feat: ..." && git push origin main
git tag -a v0.x.0 -m "v0.x.0" && git push origin v0.x.0
gh release create v0.x.0 --title "v0.x.0" --notes "..."
```

## 安全

发现安全问题请不要开公开 issue，按 [SECURITY.md](SECURITY.md) 的流程私下报告。
