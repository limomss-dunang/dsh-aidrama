# dsh-aidrama · AI 短剧工坊

![CI](https://github.com/limomss-dunang/dsh-aidrama/actions/workflows/ci.yml/badge.svg)  ![license](https://img.shields.io/badge/license-Apache--2.0-blue)

DeepSeek Harness 的**侧边栏工作台插件**：在侧边栏点「短剧」（与「生图」「视频复刻」同一形态），中栏切换为结构化的 AI 短剧 / 漫剧制片台。

不是「一句话生成器」，而是把 **构想 → 总纲 → 资产 → 分集 → 分镜 → 提示词 → 生产台账 → 质检** 做成可校验、可追溯、可协作的工程：

- **结构化项目状态**：默认 `<workspace>/.dsh-aidrama/projects/<id>/project.json`；设置里显示当前项目文件目录与项目根目录，更换根目录会移动全部项目（ID 不变）。五份 Markdown 是导出皮。
- **剧本导入**：新建项目或已有项目可导入 TXT / Markdown / DOCX，或直接粘贴；按「第X集 / EP01」自动拆集，解析角色/场景/道具与每集节拍，只把第一集跑到分镜和提示词；先预览、可改关键字段，确认后才写入。解析模型可在设置里单独指定。
- **MiMo 音色 + Seedance 2.0 对白视频**：角色可用 `mimo-v2.5-tts-voicedesign` 生成音色样音；分镜把样音作为 `reference_audio` 交给 Seedance 2.0，生成带对白的视频。MiMo 与方舟接口在设置里手动填，Key 只存本机。
- **豆包 Seedream 图片**：角色正/侧/背三视图、场景/道具参考图、分镜首帧都可生成；每个视图有独立提示词，改完可重抽。
- **LOOK 造型切换**：身份锁与服装分离；每个 LOOK 有独立描述、适用集数、正/侧/背/三视图参考图；分镜按 `wardrobe` 选 LOOK。保持造型就绑同一个 LOOK，换装只在换装点之后切新 LOOK。
- **自动时长**：可切 `fixed/auto`；auto 按分镜实际时长或剧本字数回填每集目标，再按目标重分节拍。GEN-005 按每集目标校验，不再统一卡 90 秒。
- **生成前置检查**：生成本集节拍/分镜前检查总纲、一句话、角色、场景；缺项直接提示/拒绝，不把空项目发给模型。
- **资产锁**：角色 8+1 槽位 → 只读锁面；分镜只引用 ID，编译时逐字写入。
- **模型方言编译器**：提示词方言自动跟随视频模型（Seedance 2.0/2.5、MiniMax H3、Kling、Wan），不再单独设置；通用中文作为兜底。
- **硬校验**：ID/引用/节拍时长/台词容量/一镜一动作/参考图四态/身份锁与 LOOK/时间戳/H3 互斥/矛盾约束/成本时间盒。
- **DSH 原生模型**：文本生成走「设置 → 模型」里已配置的提供商，不需要另填 Key。
- **Agent 可操作**：`aidrama_status`、`aidrama_generate` 两个工具读写当前会话绑定的项目。
- **重启可恢复**：客户端持续识别 session；没有 session 时宿主用最近绑定兜底，不会把项目误判为丢失。
- **不占 View 标签**：与生图 / 视频复刻一致，侧边栏入口 + 中栏接管；会话子树保持挂载，切回「会话」状态不丢。

## 安装

**方式一：插件市场 / 图形界面**

1. 设置 → 插件 → 安装插件，选择本仓库（或从 Release 下载 tarball）。
2. 安装后**重启 DSH**（新增 bundle 行需要重启才会加载宿主半边）。
3. 侧边栏出现「短剧」入口；设置对话框左侧出现「AI 短剧工坊」。

**方式二：本地开发**

```bash
npm install          # 依赖 + prepare 自动构建 lib/
npm run build        # 手动重建两半
npm run typecheck    # tsc --noEmit
```

## 开发

```bash
pnpm --filter dsh-aidrama build      # tsdown → lib/index.js + lib/client.js
pnpm --filter dsh-aidrama typecheck
```

## 目录

```
src/host/      宿主半：配置、项目存储、LLM、生成器、编译器、校验器、导出、路由、工具
src/client/    浏览器半：侧边栏入口 / 中栏工作台、检查器、面板
src/shared/    共享类型与路由常量
docs/          调研报告与设计文档
research/      原始调研笔记与证据
```

## 边界

- 图片/视频/音色走手动接口：Seedream、Seedance 2.0、MiMo voicedesign；Key 明文存本机，不托管。
- 不做 NLE、不做投流、不做多租户、不替代 DSH 的 Agent/审批/会话；不做逐句 TTS 时间线与混音。
- 自动时长是估算，不是精确成片时长；改完内容要再点「按内容回填」。
- 导出为 Markdown 是为了交接给 drama-skills 等外部工具；不从 Markdown 反向解析，避免两套真相。
- 桌面端视觉/交互仍需人工验收；协议与落盘用本地 mock 验证，不替用户消耗真实额度。

详细调研与设计见 [docs/00-调研报告.md](docs/00-调研报告.md)、[docs/01-插件设计.md](docs/01-插件设计.md)、[docs/02-TTS与模型配置调研.md](docs/02-TTS与模型配置调研.md)。
