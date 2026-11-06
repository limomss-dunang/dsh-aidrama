# TTS 与模型配置调研（对照四个参考项目 + 本地视频复刻）

> 目的：回答「TTS 到底怎么处理、怎么保证一致性、设置应该分几类」。
> 结论先行：**TTS 应该是独立模型，不是视频模型的一部分；四类设置（文本/图片/视频/语音）比三类更准确。**
> 调研时间：2026-11-05。

## 1. 结论

1. **TTS 不能默认交给视频模型。** 视频模型的原生音频适合环境音/氛围，不适合按剧本逐句、固定角色音色的对白；跨镜头音色会漂移，改一句台词要重生成整段视频，且台词准确率不可控。
2. **TTS 应该是独立的一类模型设置**，与文本、图片、视频并列。用户说的「三类」漏了语音；准确说是四类。
3. **一致性靠「固定身份 + 固定时间线」**，不是靠一次生成：
   - 声音身份：每个角色固定 `voice_id` / 参考音频 / 模型版本；
   - 表演：情绪、语速、音量、音高按台词标注映射，不改变身份；
   - 时间：先合成台词拿到真实时长，再反推镜头时长；字幕用 TTS 时间戳，不靠镜头时长猜；
   - 混音：对白、BGM、SFX 分层，BGM 在对白下 ducking；切点做电平检查。
4. **视频模型的原生音频可以保留为可选环境音**，但对白仍应走 TTS；除非供应商明确支持「每角色参考音频 + 逐句对白」且实测稳定，才考虑把对白交给视频模型。

## 2. 四个参考项目怎么处理 TTS

| 项目 | TTS 位置 | 音色分配 | 时间对齐 | 一致性手段 | 主要局限 |
|---|---|---|---|---|---|
| **drama-skills**（zenstory-ai） | 独立 `tts` 模态，内置 MiniMax Speech 适配器；同时支持把角色参考音频绑进视频模型 | 每个角色在《视觉设定》记 `voice_id` / 声音参考；同一角色每句用同一音色 | 逐句台词合成，剪辑单支持 L-cut/J-cut、跨切点字幕、有声区间检查 | 固定 `voice_id` + 同一参考音频 + 语气参数（emotion/speed/vol/pitch）+ 专名发音表；参考音频只控制音色，不控制台词/情绪 | 是技能/契约套件，不是开箱应用；需要创作者准备每个角色的声音参考并登记 |
| **LocalMiniDrama** | 后端 `ttsService`，按**分镜**合成对白/旁白 | 一套全局 TTS 配置一个 `voice_id`，没有按角色绑定 | 每个分镜一个 mp3，后续拼接/合成 | 靠全局音色；没有多角色区分 | 多角色会共用同一嗓子；`voice_style` 字段存在但 TTS 未使用 |
| **kineo**（Agions） | 独立 TTS 服务，Edge TTS 真实实现；6 个 provider 音色表，但多数是 stub | 按角色性别/名字启发式推荐，也允许直接传 `voiceId` | 按对白逐条合成，缓存 + 并发控制 | 固定角色音色 + 情绪感知语速/音高 + 文本缓存 | 只有 Edge 真正可用；流水线里的 `step-audio-synthesis` 还是占位（返回 `tts://` 与估算时长），实际 UI 走 `AutoVoiceSynthesizer` |
| **huobao-drama**（chatfire） | **没有独立 TTS**；角色上传参考音色，视频模型原生发声 | 每个角色上传 2–15 秒参考音频，视频提示词里用 `#角色名` 绑定 | 按镜头生成，音色参考随镜头提交 | 参考音频绑定 + 提示词 `@形象` / `#音色` 分离 + 上传校验 | 完全依赖视频模型；部分供应商要公网音频 URL；改一句台词要重生成整镜；跨镜音色一致性取决于模型 |
| **dsh-video-replica**（本地） | 可选 TTS，按**分块**合成；OpenAI `/audio/speech` + chat-tts 兜底 | 一套全局 `voice`，没有按角色 | 把该块所有分镜口播拼成一段，`apad,atrim` 补/截到块时长；字幕按分镜时长推算 | 全局音色 + 分块对齐 | 单音色无法多角色；`atrim` 可能截断台词；字幕不看 TTS 真实时间戳 |

### 2.1 两种主流路线

**路线 A：独立 TTS（LocalMiniDrama / kineo / drama-skills / 本地视频复刻）**

```
剧本台词（说话人 + 情绪）
  → 每个角色固定音色 / 参考音频
  → 逐句 TTS
  → 得到每句时长与时间戳
  → 反推镜头时长 / 字幕时间
  → 视频按镜头生成
  → 混音（对白 + BGM + SFX）
```

优点：台词可控、可单句重录、字幕可精确、角色音色可固定；缺点：多一步，需要时间线。

**路线 B：视频模型原生音频 + 音色参考（huobao / drama-skills 的可选绑定）**

```
角色参考音频 + 分镜提示词（#角色音色）
  → 视频模型一次生成画面 + 声音
  → 拼接
```

优点：步骤少，口型可能更好；缺点：模型依赖强、改一句要重生成整镜、跨镜音色不稳、部分模型要求公网 URL。

### 2.2 drama-skills 的实测信号

其 `voice-delivery-and-model-choice.md` 记录了一个小样本：Wan 3.0 只写文字音色描述时，角色说话人相似度约 **0.25–0.37**；挂同一角色另一句话的参考音频后，两个角色到 **0.69**。同时，把本句台词音频挂上去让模型对口型，音色相似度更高（0.80–0.93），但口型盲评更低（3.1 对 3.4），所以它默认只挂「音色参考」，不挂本句台词。这个数字来自小样本，不能当通用结论，但方向明确：**参考音频对跨镜音色有帮助，但不能替代 TTS 的台词控制。**

## 3. 一致性拆解

### 3.1 声音身份（跨集不变）

- 每个角色一个 `voiceProfile`：provider、model、`voiceId`、语速基线、音高、口音、专名发音、参考音频（可选）、授权状态。
- 同一角色跨集、跨镜头永远用同一个 `voiceId` / 同一段参考音频；换音色是创作决定，要记录前后选择。
- 有克隆能力时，参考音频只控制音色；情绪、语速、录音空间不得继承（drama-skills 的 `role: timbre` / `must_not_control` 写法值得抄）。
- 专名发音单独维护发音词典；中文多音字、英文名、品牌名最容易出问题。
- 视频模型如果也吃参考音频，只把它当「音色辅助」，不要让它替代 TTS 的台词。

### 3.2 表演（逐句变化）

- 台词上标注 `emotion`、`speed`、`volume`、`pitch`；映射到 TTS 供应商支持的枚举/参数。
- 不要让「表演」污染「身份」：本场哭、喊、压低声音，是表演；角色安静说话时的音区、口音、句尾习惯，才是身份。
- 同一角色不同情绪下仍用同一 `voiceId`，只改参数。

### 3.3 时间线（TTS 驱动镜头）

- 逐句合成，记录 `audioPath`、`duration`、`start/end`；不要按字数估算。
- 镜头时长 = 该镜头台词总时长 + 呼吸/反应余量；视频按这个时长生成，而不是先生成随机长度再硬配。
- 字幕起点/终点用 TTS 的时间戳；没有时间戳时至少用逐句音频时长，不要用镜头时长推算。
- 需要 L-cut/J-cut 时，把配音放在成片时间线上，允许一句跨过切点；不要重切音频文件。
- 音频切点做电平检查（drama-skills 用切点前后 0.4s 的 RMS，超过 10dB 提示回听）；BGM 在对白下 ducking。

### 3.4 混音

- 对白 / BGM / SFX 分轨；BGM 音量默认压到对白以下，对白出现时自动 ducking。
- 统一采样率/声道（如 48kHz stereo），切点处不要逐段编码 AAC 再流拷贝，避免 32ms 掉音；先解码成 PCM，拼接后只编码一次。
- 输出前做响度归一化；保留一版无 BGM 的对白轨，方便重混。

### 3.5 质检

- 声音：说话人相似度（有参考时）、专名发音、跨集音色漂移、切点电平跳变。
- 画面：角色/服装/道具/场景一致性（参考图 + 首帧 + 固定 seed/模型/参数）。
- 时间：台词是否被截断、字幕是否越界/重叠、口型是否明显错位。
- 失败只重生成单句/单镜，不整片重来。

## 4. 给 dsh-aidrama 的推荐

### 4.1 设置结构：四类，不是三类

| 类别 | 配置项 | 用途 |
|---|---|---|
| **文本** | provider / model；解析专用 provider / model | 剧本解析、总纲、资产、分镜、提示词增强 |
| **图片** | provider / model / baseURL / key；尺寸、参考图模式、seed | 角色/场景/道具参考图、分镜首帧 |
| **视频** | provider / model / protocol；单镜时长、分辨率、首/尾帧、原生音频开关 | 首帧图生视频、逐镜生成 |
| **语音 TTS** | provider / model / protocol；每角色 voiceId / 参考音频；语速、音高、情绪映射、输出格式 | 对白/旁白逐句合成、时间线、混音 |
| 可选 ASR | provider / model | 字幕对齐、口型检查、参考视频转写（不是必需） |

> 如果产品上坚持叫「三类」，可以把 TTS 放在「音频」子类里，但**配置和调用必须独立**，不能塞进视频模型。

### 4.2 推荐落地顺序

1. **先做 TTS 独立模型 + 每角色音色**：逐句合成、记录时长、生成时间线；视频先不接原生音频。
2. **再做图片**：角色/场景/道具参考图 + 首帧；图片模型支持参考图时优先用参考图，而不是纯文字。
3. **再做视频**：首帧图生视频；默认 `generate_audio: false`；时长由 TTS 时间线给出。
4. **最后做混音/字幕**：对白 + BGM + SFX；字幕用 TTS 时间戳；切点电平检查。
5. 如果目标视频模型确实支持「每角色参考音频 + 逐句对白」且实测稳定，再增加「视频原生对白」可选开关，但不作为默认。

### 4.3 数据模型建议

```ts
interface VoiceProfile {
  provider: string          // minimax | volcengine | edge | openai | custom
  model: string             // speech-02-hd / doubao-tts / ...
  voiceId: string           // 角色固定音色
  speed: number
  pitch: number
  emotionMap?: Record<string, string>
  referenceAudio?: string   // 可选；只控制音色
  consent?: 'creator_owned' | 'licensed' | 'preset' | 'unknown'
  pronunciation?: Record<string, string>
}

interface DialogueLine {
  id: string
  speakerId: string         // 角色 ID
  text: string
  emotion?: string
  audioPath?: string
  audioDurationSec?: number
  startSec?: number
  endSec?: number
  subtitle?: string
}
```

`Character` 挂 `voiceProfile`；`Shot` 挂 `dialogueLines` 或引用台词 ID；时间线由台词音频计算，不靠字数估算。

### 4.4 为什么不建议直接把 TTS 塞进视频模型

- 改一句词要重生成整段视频，成本和等待都不可接受；
- 视频模型的「台词准确率」和「角色音色一致性」不可控；
- 字幕、口型、混音都需要独立时间线；
- 多角色对白需要每个角色独立音色，视频模型很难逐句绑定。

## 5. 风险与待确认

- **供应商选择**：MiniMax Speech、火山豆包语音、Edge TTS、OpenAI TTS、本地 CosyVoice/GPT-SoVITS，各有音色/克隆/价格差异；需要你定。
- **是否需要声音克隆**：克隆一致性最好，但涉及授权、参考音频质量、供应商支持；不做克隆也能用预置音色 + 固定 voiceId。
- **是否需要口型同步**：短剧/漫剧很多是「旁白 + 画面」或「对白 + 反应镜头」，不一定需要逐帧 lip-sync；如果要，TTS 时间戳 + 口型模型是另一条链路。
- **视频模型原生音频**：如果目标模型（Seedance 2.0/2.5、Wan、MiniMax H3）原生音频实测足够好，可以作为可选环境音；对白仍建议 TTS。
- **成本**：逐句 TTS 调用次数多，但单次便宜；视频重生成才是大头。先 TTS 后视频，反而更省。

## 6. 本次落地选择（2026-11-05）

按「先做简单点」定的是路线 B 的简化版：

1. `mimo-v2.5-tts-voicedesign` 按角色生成一条**音色样音**，存项目 `audio/voice-<角色>.wav`；不把它当 voiceId，不逐句 TTS。
2. Seedance 2.0 生成对白视频时，把样音作为 `reference_audio`，把分镜首帧/参考图作为 `reference_image`，`generate_audio: true`；台词由分镜提示词里的对白决定。
3. 角色面板可试听/重设计音色；分镜面板可上传首帧、一键生成对白视频，结果存 `videos/<shotId>.mp4`。
4. 图片走豆包 Seedream（方舟 `/api/v3/images/generations`）：角色正/侧/背三视图、三视图合一、场景/道具参考图、分镜首帧都可生成；每个视图有独立提示词，改完可重抽。
5. 已知限制：Seedance 2.0 带参考音频时至少需要一张参考图；参考图含真人人脸可能被方舟拒绝；台词准确率/跨镜音色由视频模型决定，改词需重生成整镜。

## 7. 参考来源

- [zenstory-ai/drama-skills](https://github.com/zenstory-ai/drama-skills)
  - `.agents/notes/implemented/feature/2026-09-28-voice-delivery-and-model-choice.md`
  - `.agents/notes/implemented/feature/2026-09-28-voice-reference-binding.md`
  - `.agents/notes/implemented/feature/2026-09-28-edit-voice-across-cuts.md`
  - `skills/short-drama-produce/references/providers/minimax-speech.md`
  - `skills/short-drama-assets/references/voice-direction.md`
- [xuanyustudio/LocalMiniDrama](https://github.com/xuanyustudio/LocalMiniDrama)
  - `backend-node/src/services/ttsService.js`
  - `backend-node/src/routes/audio.js`
- [Agions/kineo](https://github.com/Agions/kineo)
  - `src/core/services/audio/tts-service.ts`
  - `src/core/services/audio/AutoVoiceSynthesizer.ts`
  - `src/core/services/audio/tts-voices.ts`
  - `src/core/pipeline/step-audio-synthesis.ts`
- [chatfire-AI/huobao-drama](https://github.com/chatfire-AI/huobao-drama)
  - `backend/src/services/character-voice-references.ts`
  - `backend/src/services/reference-audio.ts`
  - `backend/src/agents/voice-reference-instructions.ts`
  - `frontend/app/components/CharacterVoice.vue`
- 本地 `plugins/dsh-video-replica`
  - `src/host/providers/tts.ts`
  - `src/host/pipeline.ts`（配音与字幕段）
  - `src/host/media.ts`（`fitAudio` / `muxFinal`）
