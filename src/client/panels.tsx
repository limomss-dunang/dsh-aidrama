/** 阶段面板：构想、总纲、资产、分集、分镜、提示词、生产、质检。 */

import type { Beat, Character, DialectId, Episode, Finding, Project, Shot, ValidationResult } from '../shared/types.ts'
import { DIALECTS, GENRES, PLATFORMS } from '../shared/types.ts'
import { missingPrerequisites } from '../shared/precheck.ts'
import { groupShotsIntoSegments } from '../shared/segments.ts'
import { defaultStyle, fillStyleDefaults } from '../shared/style-presets.ts'
import { tt } from './locale.ts'
import {
  Area, Badge, Btn, Field, Findings, GENRE_LABEL, Input, PLATFORM_LABEL, SectionTitle, Select,
  SIZE_OPTIONS, BEAT_FUNCTIONS, BEAT_FUNCTION_LABELS, type AssetKind, type Mutate, type Selection,
} from './ui.tsx'

export function ConceptPanel(props: { project: Project, mutate: Mutate, onBible: () => void, busy: string }) {
  const { project, mutate } = props
  const meta = project.meta
  return (
    <div>
      <SectionTitle title="构想" hint="一句话必须含主角、目标、阻碍、代价；它决定后面所有阶段。" actions={
        <Btn kind="primary" onClick={props.onBible} disabled={props.busy !== ''}>
          {props.busy === '生成总纲' ? tt('generating') : tt('generateBible')}
        </Btn>
      } />
      <div className="ad-grid2">
        <Field label="剧名"><Input value={project.title} onChange={value => mutate(draft => { draft.title = value })} /></Field>
        <Field label="一句话（logline）"><Input value={meta.logline} placeholder="外卖员在高级餐厅被羞辱，亮出集团董事身份"
          onChange={value => mutate(draft => { draft.meta.logline = value })} /></Field>
        <Field label="主题命题"><Input value={meta.theme} onChange={value => mutate(draft => { draft.meta.theme = value })} /></Field>
        <Field label="开场 3 秒钩子"><Input value={meta.hook} placeholder="要可视觉化，不要旁白解释"
          onChange={value => mutate(draft => { draft.meta.hook = value })} /></Field>
        <Field label="平台">
          <Select value={meta.platform} options={PLATFORMS.map(id => ({ value: id, label: PLATFORM_LABEL[id] ?? id }))}
            onChange={value => mutate(draft => { draft.meta.platform = value as Project['meta']['platform'] })} />
        </Field>
        <Field label="题材">
          <Select value={meta.genre} options={GENRES.map(id => ({ value: id, label: GENRE_LABEL[id] ?? id }))}
            onChange={value => mutate(draft => { draft.meta.genre = value as Project['meta']['genre'] })} />
        </Field>
        <Field label="画幅">
          <Select value={meta.orientation} options={[{ value: 'portrait', label: '9:16 竖屏' }, { value: 'landscape', label: '16:9 横屏' }]}
            onChange={value => mutate(draft => { draft.meta.orientation = value as Project['meta']['orientation'] })} />
        </Field>
        <Field label="目标集数"><Input value={String(meta.targetEpisodes)}
          onChange={value => mutate(draft => { draft.meta.targetEpisodes = Math.max(1, Number(value) || 1) })} /></Field>
        <Field label="单集时长（秒）"><Input value={String(meta.episodeSeconds)}
          onChange={value => mutate(draft => { draft.meta.episodeSeconds = Math.max(15, Number(value) || 90) })} /></Field>
        <label className="ad-row ad-tiny" style={{ alignSelf: 'end', paddingBottom: 8 }}>
          <input type="checkbox" checked={meta.durationMode === 'auto'}
            onChange={event => mutate(draft => { draft.meta.durationMode = event.target.checked ? 'auto' : 'fixed' })} />
          单集时长自动（分集页按对白/动作回填）
        </label>
        <Field label="受众"><Input value={meta.audience} placeholder="如：25–40 岁女性，通勤场景"
          onChange={value => mutate(draft => { draft.meta.audience = value })} /></Field>
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label="禁区（一行一条）">
          <Area rows={3} value={meta.forbidden.join('\n')} placeholder="不仿冒现实人物；不出现真实品牌；不美化暴力"
            onChange={value => mutate(draft => { draft.meta.forbidden = value.split('\n').map(item => item.trim()).filter(Boolean) })} />
        </Field>
      </div>
      <p className="ad-note" style={{ marginTop: 10 }}>写不出时先点「生成总纲」：会用 DSH 已配置模型产出一版，之后所有字段都可以手改。</p>
    </div>
  )
}

export function BiblePanel(props: { project: Project, mutate: Mutate, onGenerate: () => void, busy: string }) {
  const { project, mutate } = props
  return (
    <div>
      <SectionTitle title="总纲" hint="主题、世界、三幕、分集规划、视觉方向；改这里会反映到导出的 00-总纲.md。" actions={
        <Btn kind="primary" onClick={props.onGenerate} disabled={props.busy !== ''}>
          {props.busy === '生成总纲' ? tt('generating') : tt('generateBible')}
        </Btn>
      } />
      <div className="ad-col">
        <Field label="一句话卖点 / 前提"><Area rows={2} value={project.bible.premise} onChange={value => mutate(draft => { draft.bible.premise = value })} /></Field>
        <Field label="世界观 / 时代 / 空间规则"><Area rows={4} value={project.bible.world} onChange={value => mutate(draft => { draft.bible.world = value })} /></Field>
        <Field label="三幕 / 起承转合"><Area rows={4} value={project.bible.arc} onChange={value => mutate(draft => { draft.bible.arc = value })} /></Field>
        <Field label="分集规划（每集一句钩子）"><Area rows={6} value={project.bible.episodePlan} onChange={value => mutate(draft => { draft.bible.episodePlan = value })} /></Field>
        <Field label="视觉方向（画风/色调/光线/镜头/禁用）"><Area rows={4} value={project.bible.visualDirection} onChange={value => mutate(draft => { draft.bible.visualDirection = value })} /></Field>
      </div>
    </div>
  )
}

function CharacterCard(props: { character: Character, onClick: () => void }) {
  const { character } = props
  const appearsIn = character.appearsIn ?? []
  return (
    <div className="ad-card" data-clickable="true" onClick={props.onClick}>
      <div className="ad-card-title">
        <span className="ad-id">{character.id}</span>
        <span>{character.name || '未命名角色'}</span>
        <span className="ad-spacer" />
        <Badge level={character.status === 'locked' ? 'ok' : 'info'}>{character.status === 'locked' ? '已锁定' : '草稿'}</Badge>
      </div>
      <div className="ad-card-body">
        {character.role || '未设定位'} · LOOK {character.looks.length} · 状态变体 {character.stateVariants.length}
        {'\n'}{appearsIn.length === 0 ? '出现集数：未关联' : `出现集数：${appearsIn.join('、')}`}
        {'\n'}{character.lockText || '锁面待补：填满九槽后自动生成'}
      </div>
    </div>
  )
}

export function AssetsPanel(props: {
  project: Project
  mutate: Mutate
  tab: AssetKind
  setTab: (tab: AssetKind) => void
  select: (selection: Selection) => void
  onGenerate: (stage: 'characters' | 'scenes' | 'props') => void
  episodeId: string | undefined
  setEpisodeId: (id: string) => void
  busy: string
}) {
  const { project, mutate, tab } = props
  const filterEpisode = project.episodes.find(item => item.id === props.episodeId)
  const visible = <T extends { appearsIn?: string[] }>(items: T[]): T[] => filterEpisode === undefined
    ? items
    : items.filter(item => (item.appearsIn ?? []).length === 0 || (item.appearsIn ?? []).includes(filterEpisode.id))
  const characters = visible(project.characters)
  const scenes = visible(project.scenes)
  const propsList = visible(project.props)
  const primaryStyle = project.styles[0]
  const ensureStyle = (): void => {
    mutate(draft => {
      if (draft.styles.length > 0) return
      draft.styles.push(defaultStyle(draft))
    })
  }
  const sharedCount = tab === 'character' ? project.characters.length : tab === 'scene' ? project.scenes.length : tab === 'prop' ? project.props.length : project.styles.length
  const visibleCount = tab === 'character' ? characters.length : tab === 'scene' ? scenes.length : tab === 'prop' ? propsList.length : project.styles.length
  const add = (): void => {
    if (tab === 'character') {
      mutate(draft => {
        const index = draft.characters.length + 1
        draft.characters.push({
          id: `C${String(index).padStart(2, '0')}`, name: '新角色', role: '', status: 'draft', appearsIn: [],
          slots: { ageGender: '', face: '', hair: '', body: '', outfit: '', accessories: '', temperament: '', forbidden: '', lightBaseline: '' },
          lockText: '', identityLock: '', looks: [], stateVariants: [],
          refs: { front: '', side: '', back: '', expression: '', main: '' },
          refPrompts: { front: '', side: '', back: '', sheet: '' },
          voiceCard: {
            voiceId: '', ageRange: '', rate: '', baseline: '', forbidden: '',
            voiceSample: '', designPrompt: '', sampleText: '', designedAt: 0,
          },
        })
      })
    } else if (tab === 'scene') {
      mutate(draft => {
        draft.scenes.push({ id: `S${String(draft.scenes.length + 1).padStart(2, '0')}`, name: '新场景', appearsIn: [], space: '', props: '', palette: '', keyLight: '', refImage: '', variants: [] })
      })
    } else if (tab === 'prop') {
      mutate(draft => {
        draft.props.push({ id: `P${String(draft.props.length + 1).padStart(2, '0')}`, name: '新道具', appearsIn: [], function: 'evidence', appearance: '', owner: '', endPosition: '', refImage: '' })
      })
    } else {
      mutate(draft => {
        draft.styles.push({ id: `STYLE_${String.fromCharCode(65 + draft.styles.length)}`, name: '新风格锚', prompt: '', avoid: [] })
      })
    }
  }
  const generateStage: 'characters' | 'scenes' | 'props' | undefined =
    tab === 'character' ? 'characters' : tab === 'scene' ? 'scenes' : tab === 'prop' ? 'props' : undefined
  return (
    <div>
      <SectionTitle title="资产" hint="角色 8+1 槽位与锁面是跨镜一致性的第一道闸；锁定后字段只读。" actions={
        <div className="ad-row">
          <Btn onClick={add}>{tt('add')}</Btn>
          {generateStage === undefined ? null : (
            <Btn kind="primary" disabled={props.busy !== ''} onClick={() => props.onGenerate(generateStage)}>
              {props.busy === '生成资产' ? tt('generating') : tab === 'character' ? tt('generateCharacters') : tab === 'scene' ? tt('generateScenes') : tt('generateProps')}
            </Btn>
          )}
        </div>
      } />
      <div className="ad-card" style={{ padding: 10, marginBottom: 10 }}>
        <div className="ad-row">
          <strong>全局风格锚</strong>
          <Badge level={primaryStyle?.status === 'accepted' ? 'ok' : 'warn'}>{primaryStyle?.status === 'accepted' ? '已锁定' : '待锁定'}</Badge>
          <span className="ad-note" style={{ margin: 0 }}>所有角色图、场景图、首帧、视频都会按 L1 风格锚 + L5 场景色调生成；未锁定不允许出媒体。</span>
          <span className="ad-spacer" />
          {primaryStyle === undefined ? <Btn onClick={ensureStyle}>从视觉方向创建</Btn> : (
            <>
              <Btn onClick={() => mutate(draft => fillStyleDefaults(draft))}>填充缺失默认值</Btn>
              <Btn kind={primaryStyle.status === 'accepted' ? 'ghost' : 'primary'}
                onClick={() => mutate(draft => { if (draft.styles[0] !== undefined) draft.styles[0].status = draft.styles[0].status === 'accepted' ? 'proposed' : 'accepted' })}>
                {primaryStyle.status === 'accepted' ? '退回提案' : '锁定风格'}
              </Btn>
            </>
          )}
        </div>
        {primaryStyle === undefined ? (
          <p className="ad-note" style={{ margin: '6px 0 0' }}>没有风格锚时，图片和视频会各生成各的风格。先创建并确认一条主风格。</p>
        ) : (
          <div className="ad-col" style={{ marginTop: 8 }}>
            <div className="ad-grid2">
              <Field label="风格名"><Input value={primaryStyle.name} onChange={value => mutate(draft => { if (draft.styles[0] !== undefined) draft.styles[0].name = value })} /></Field>
              <Field label="媒介/渲染（L1）"><Input value={primaryStyle.medium ?? ''} placeholder="3D国风 / 写实电影 / 2D赛璐璐" onChange={value => mutate(draft => { if (draft.styles[0] !== undefined) draft.styles[0].medium = value })} /></Field>
              <Field label="全片色彩基调（L5）"><Input value={primaryStyle.palette ?? ''} placeholder="宫宴鎏金暖光 / 天牢青灰冷光" onChange={value => mutate(draft => { if (draft.styles[0] !== undefined) draft.styles[0].palette = value })} /></Field>
              <Field label="光线基调"><Input value={primaryStyle.lighting ?? ''} placeholder="冷暖对冲、硬光、低饱和" onChange={value => mutate(draft => { if (draft.styles[0] !== undefined) draft.styles[0].lighting = value })} /></Field>
              <Field label="镜头语言"><Input value={primaryStyle.lens ?? ''} placeholder="竖屏中近景、越肩、仰拍" onChange={value => mutate(draft => { if (draft.styles[0] !== undefined) draft.styles[0].lens = value })} /></Field>
              <Field label="材质/皮肤/颗粒"><Input value={primaryStyle.texture ?? ''} placeholder="布料磨损、金属哑光、轻微胶片颗粒" onChange={value => mutate(draft => { if (draft.styles[0] !== undefined) draft.styles[0].texture = value })} /></Field>
              <Field label="禁用"><Input value={primaryStyle.avoid.join('、')} onChange={value => mutate(draft => { if (draft.styles[0] !== undefined) draft.styles[0].avoid = value.split(/[,，、\s]+/).filter(Boolean) })} /></Field>
              <Field label="风格参考图（路径）"><Input value={primaryStyle.referenceImage ?? ''} placeholder="refs/style-lock.jpg" onChange={value => mutate(draft => { if (draft.styles[0] !== undefined) draft.styles[0].referenceImage = value })} /></Field>
            </div>
            <Field label="风格说明（只写画风/材质，不写剧情）"><Area rows={3} value={primaryStyle.prompt} onChange={value => mutate(draft => { if (draft.styles[0] !== undefined) draft.styles[0].prompt = value })} /></Field>
          </div>
        )}
      </div>
      <div className="ad-row" style={{ margin: '8px 0' }}>
        <Select value={filterEpisode?.id ?? ''} options={[{ value: '', label: '全部集' }, ...project.episodes.map(episode => ({ value: episode.id, label: `${episode.id} ${episode.title}` }))]}
          onChange={value => props.setEpisodeId(value)} />
        <Badge level="info">本集 {visibleCount}</Badge>
        <Badge>共享库 {sharedCount}</Badge>
        <span className="ad-note" style={{ margin: 0 }}>资产只存一份；这里按“出现集数”过滤，不是复制。</span>
      </div>
      <div className="ad-tabs">
        {([['character', 'characters'], ['scene', 'scenes'], ['prop', 'props'], ['style', 'styles']] as const).map(([id, label]) => (
          <button key={id} type="button" data-active={tab === id} onClick={() => props.setTab(id)}>
            {tt(label)}（{id === 'character' ? project.characters.length : id === 'scene' ? project.scenes.length : id === 'prop' ? project.props.length : project.styles.length}）
          </button>
        ))}
      </div>
      {tab === 'character' ? (
        <div className="ad-grid3">
          {characters.map(character => (
            <CharacterCard key={character.id} character={character} onClick={() => props.select({ kind: 'character', id: character.id })} />
          ))}
          {characters.length === 0 ? <p className="ad-muted">本集还没有引用角色。切换“全部集”可查看共享库，或在角色页手动补关联。</p> : null}
        </div>
      ) : null}
      {tab === 'scene' ? (
        <div className="ad-grid2">
          {scenes.map(scene => (
            <div key={scene.id} className="ad-card" data-clickable="true" onClick={() => props.select({ kind: 'scene', id: scene.id })}>
              <div className="ad-card-title"><span className="ad-id">{scene.id}</span><span>{scene.name || '未命名场景'}</span></div>
              <div className="ad-card-body">{scene.space || '空间结构待补'}{'\n'}{scene.palette}{scene.keyLight ? ` · ${scene.keyLight}` : ''}{'\n'}出现集数：{scene.appearsIn.length === 0 ? '未关联' : scene.appearsIn.join('、')}</div>
            </div>
          ))}
        </div>
      ) : null}
      {tab === 'prop' ? (
        <div className="ad-grid2">
          {propsList.map(prop => (
            <div key={prop.id} className="ad-card" data-clickable="true" onClick={() => props.select({ kind: 'prop', id: prop.id })}>
              <div className="ad-card-title"><span className="ad-id">{prop.id}</span><span>{prop.name || '未命名道具'}</span><Badge>{prop.function}</Badge></div>
              <div className="ad-card-body">{prop.appearance || '外观待补'}{'\n'}持有：{prop.owner || '待定'} · 结束：{prop.endPosition || '待定'}{'\n'}出现集数：{prop.appearsIn.length === 0 ? '未关联' : prop.appearsIn.join('、')}</div>
            </div>
          ))}
        </div>
      ) : null}
      {tab === 'style' ? (
        <div className="ad-grid2">
          {project.styles.map(style => (
            <div key={style.id} className="ad-card" data-clickable="true" onClick={() => props.select({ kind: 'style', id: style.id })}>
              <div className="ad-card-title"><span className="ad-id">{style.id}</span><span>{style.name}</span></div>
              <div className="ad-card-body">{style.prompt || '风格提示词待补'}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function EpisodePanel(props: {
  project: Project
  mutate: Mutate
  episodeId: string | undefined
  setEpisodeId: (id: string) => void
  onNewEpisode: () => void
  onGenerateEpisode: () => void
  onEstimate: () => void
  busy: string
}) {
  const { project, mutate } = props
  const episode = project.episodes.find(item => item.id === props.episodeId) ?? project.episodes[0]
  const missing = missingPrerequisites(project, 'episode')
  const patchEpisode = (fn: (episode: Episode) => void): void => {
    if (episode === undefined) return
    mutate(draft => {
      const target = draft.episodes.find(item => item.id === episode.id)
      if (target !== undefined) fn(target)
    })
  }
  return (
    <div>
      <SectionTitle title="分集" hint="自动模式按对白/动作回填实际时长；固定模式才用单集时长卡。" actions={
        <div className="ad-row">
          <Btn onClick={props.onNewEpisode}>{tt('newEpisode')}</Btn>
          <Btn onClick={props.onEstimate} disabled={props.busy !== ''}>按内容回填时长</Btn>
          <Btn kind="primary" onClick={props.onGenerateEpisode} disabled={props.busy !== '' || missing.length > 0}
            title={missing.length > 0 ? `前置条件未满足：${missing.join('、')}` : undefined}>
            {props.busy === '生成本集节拍' ? tt('generating') : tt('generateEpisode')}
          </Btn>
        </div>
      } />
      {missing.length > 0 ? (
        <p className="ad-note" style={{ color: 'var(--dsw-alias-label-warn, #d97706)' }}>
          前置条件未满足：{missing.join('、')}。补齐后再点「生成本集节拍」。
        </p>
      ) : null}
      {episode === undefined ? <p className="ad-muted">还没有分集。点「新建一集」或「生成本集节拍」。</p> : (
        <div className="ad-split">
          <div className="ad-list">
            {project.episodes.map(item => (
              <button key={item.id} type="button" data-active={item.id === episode.id} onClick={() => props.setEpisodeId(item.id)}>
                <strong>{item.id}</strong> {item.title}
                <div className="ad-tiny ad-muted">{item.shots.length} 镜 · {(item.segments ?? []).length} 片段 · {item.scriptLocked ? '剧本已锁' : '剧本可编辑'}</div>
              </button>
            ))}
          </div>
          <div className="ad-col">
            <div className="ad-grid2">
              <Field label="集名"><Input value={episode.title} onChange={value => patchEpisode(draft => { draft.title = value })} /></Field>
              <Field label="本集一句话"><Input value={episode.logline} onChange={value => patchEpisode(draft => { draft.logline = value })} /></Field>
            </div>
            <h3 className="ad-h2">节拍表 <span className="ad-muted ad-tiny">合计 {episode.beats.reduce((sum, beat) => sum + beat.seconds, 0)}s / 目标 {episode.targetSeconds > 0 ? episode.targetSeconds : project.meta.episodeSeconds}s{episode.targetSeconds > 0 ? '（自动回填）' : ''}</span></h3>
            <table className="ad-table">
              <thead><tr><th>ID</th><th>功能</th><th>秒</th><th>内容</th><th /></tr></thead>
              <tbody>
                {episode.beats.map((beat, index) => (
                  <tr key={beat.id}>
                    <td><Input value={beat.id} onChange={value => patchEpisode(draft => { const item = draft.beats[index]; if (item !== undefined) item.id = value })} /></td>
                    <td><Select value={beat.function} options={BEAT_FUNCTIONS.map(value => ({ value, label: BEAT_FUNCTION_LABELS[value] ?? value }))}
                      onChange={value => patchEpisode(draft => { const item = draft.beats[index]; if (item !== undefined) item.function = value as Beat['function'] })} /></td>
                    <td style={{ width: 70 }}><Input value={String(beat.seconds)}
                      onChange={value => patchEpisode(draft => { const item = draft.beats[index]; if (item !== undefined) item.seconds = Number(value) || 0 })} /></td>
                    <td><Input value={beat.text} onChange={value => patchEpisode(draft => { const item = draft.beats[index]; if (item !== undefined) item.text = value })} /></td>
                    <td><Btn kind="ghost" onClick={() => patchEpisode(draft => { draft.beats.splice(index, 1) })}>×</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ad-row">
              <Btn onClick={() => patchEpisode(draft => { draft.beats.push({ id: `B${draft.beats.length + 1}`, function: 'goal', seconds: 0, text: '' }) })}>{tt('add')}节拍</Btn>
            </div>
            <h3 className="ad-h2">剧本 {episode.scriptLocked ? <Badge level="ok">资产已拆解 · 已锁</Badge> : <Badge level="info">可编辑</Badge>}</h3>
            <Area rows={14} value={episode.script} disabled={episode.scriptLocked} placeholder="场景标题、动作、对白；用【VO】【OS】【SFX】【画面文字】标记"
              onChange={value => patchEpisode(draft => { draft.script = value })} />
            <div className="ad-row">
              <Btn onClick={() => patchEpisode(draft => { draft.scriptLocked = !draft.scriptLocked })}>
                {episode.scriptLocked ? '解锁剧本（下游可能过期）' : '锁定剧本'}
              </Btn>
              <span className="ad-note" style={{ margin: 0 }}>资产拆解完成后默认锁定；改剧本会破坏已拆资产和镜头引用。</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function StoryboardPanel(props: {
  project: Project
  mutate: Mutate
  episodeId: string | undefined
  setEpisodeId: (id: string) => void
  selection: Selection
  select: (selection: Selection) => void
  onGenerateShots: () => void
  onGenerateSegmentVideo: (segmentId: string) => void
  busy: string
}) {
  const { project } = props
  const episode = project.episodes.find(item => item.id === props.episodeId) ?? project.episodes[0]
  const segments = episode === undefined ? [] : (episode.segments ?? groupShotsIntoSegments(episode.shots, episode.id))
  const selected = episode?.shots.find(shot => props.selection?.kind === 'shot' && shot.id === props.selection.id)
  return (
    <div>
      <SectionTitle title="分镜" hint="一镜一个主动作；先有起点/终点，再谈运镜。" actions={
        <div className="ad-row">
          {project.episodes.length > 1 ? (
            <Select value={episode?.id ?? ''} options={project.episodes.map(item => ({ value: item.id, label: `${item.id} ${item.title}` }))}
              onChange={props.setEpisodeId} />
          ) : null}
          <Btn kind="primary" onClick={props.onGenerateShots} disabled={props.busy !== ''}>
            {props.busy === '生成分镜' ? tt('generating') : tt('generateShots')}
          </Btn>
        </div>
      } />
      {episode === undefined ? <p className="ad-muted">先生成一集。</p> : (
        <>
          <div className="ad-row" style={{ marginBottom: 8 }}>
            <Badge level="info">{episode.shots.length} 镜</Badge>
            <Badge level="info">{segments.length} 个片段</Badge>
            <Badge level="info">合计 {episode.shots.reduce((sum, shot) => sum + shot.duration, 0)}s / 目标 {project.meta.episodeSeconds}s</Badge>
            <Badge level="info">单片段 ≤15s</Badge>
            <Btn onClick={() => {
              props.mutate(draft => {
                const target = draft.episodes.find(item => item.id === episode.id)
                if (target === undefined) return
                target.shots.push({
                  id: `SHOT-${episode.id}-${String(target.shots.length + 1).padStart(3, '0')}`,
                  sceneId: draft.scenes[0]?.id ?? '', duration: 4, size: 'medium', camera: '固定机位',
                  blocking: '', action: '', endState: '', emotion: { start: '', trigger: '', end: '' },
                  dialogue: [], sound: { ambience: '', sfx: '', music: '' }, refs: [], locks: [], wardrobe: {},
                  status: 'draft', videoPath: '', prompt: { dialect: '', text: '', compiledAt: 0, version: 0, inputHash: '', warnings: [] },
                })
                target.segments = groupShotsIntoSegments(target.shots, target.id)
              })
            }}>{tt('add')}镜头</Btn>
          </div>
          <h3 className="ad-h2">片段（一次视频任务）<span className="ad-tiny ad-muted" style={{ marginLeft: 8 }}>2–3 个子镜，总长 ≤15s</span></h3>
          <div className="ad-grid2">
            {segments.map(segment => {
              const scene = project.scenes.find(item => item.id === segment.sceneId)
              return (
                <div key={segment.id} className="ad-card">
                  <div className="ad-card-title">
                    <span className="ad-id">{segment.id}</span>
                    <span>{segment.duration}s</span>
                    <span className="ad-spacer" />
                    <Btn kind="primary" disabled={props.busy !== ''} onClick={() => props.onGenerateSegmentVideo(segment.id)}>
                      {props.busy === `segment:${segment.id}` ? '生成中…' : segment.videoPath === '' ? '生成片段视频' : '重新生成'}
                    </Btn>
                    <Badge level={segment.status === 'generated' ? 'ok' : 'info'}>{segment.status}</Badge>
                  </div>
                  <div className="ad-card-body">
                    {scene?.name ?? segment.sceneId} · {segment.shotIds.length} 子镜
                    {'\n'}{segment.shotIds.join(' / ')}
                    {segment.cast.length === 0 ? '' : `\n角色：${segment.cast.join('、')}`}
                    {segment.videoPath === '' ? '' : `\n视频：${segment.videoPath}`}
                  </div>
                </div>
              )
            })}
          </div>
          <table className="ad-table">
            <thead><tr><th>{tt('table').shot}</th><th>{tt('table').duration}</th><th>{tt('table').size}</th><th>{tt('table').camera}</th><th>{tt('table').action}</th><th>{tt('table').status}</th></tr></thead>
            <tbody>
              {episode.shots.map(shot => (
                <tr key={shot.id} data-clickable="true" data-selected={selected?.id === shot.id}
                  onClick={() => props.select({ kind: 'shot', id: shot.id })}>
                  <td><span className="ad-id">{shot.id}</span></td>
                  <td>{shot.duration}s</td>
                  <td>{shot.size}</td>
                  <td>{shot.camera}</td>
                  <td style={{ maxWidth: 320 }}>{shot.action || <span className="ad-muted">待补</span>}</td>
                  <td><Badge level={shot.status === 'compiled' || shot.status === 'approved' ? 'ok' : 'info'}>{shot.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          {episode.shots.length === 0 ? <p className="ad-muted">点「生成分镜」让模型按本集剧本拆镜。</p> : null}
          {episode.shots.length === 0 ? null : (
            <div className="ad-col" style={{ marginTop: 12 }}>
              {episode.shots.map(shot => (
                <div key={shot.id} className="ad-card">
                  <div className="ad-card-title">
                    <span className="ad-id">{shot.id}</span>
                    <span>{shot.duration}s · {shot.size}</span>
                    <span className="ad-spacer" />
                    <Badge level={shot.status === 'compiled' ? 'ok' : 'info'}>{shot.status}</Badge>
                  </div>
                  <div className="ad-card-body">{shot.action || '主动作待补'}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function PromptsPanel(props: {
  project: Project
  episodeId: string | undefined
  setEpisodeId: (id: string) => void
  dialect: DialectId
  onCompile: (shotId?: string) => void
  busy: string
  findings: Finding[]
}) {
  const { project } = props
  const episode = project.episodes.find(item => item.id === props.episodeId) ?? project.episodes[0]
  const compiled = episode?.shots.filter(shot => shot.prompt.text.trim() !== '').length ?? 0
  return (
    <div>
      <SectionTitle title="提示词" hint="方言自动跟随视频模型；不要用相近模型的语法硬套。" actions={
        <Btn kind="primary" disabled={props.busy !== '' || episode === undefined} onClick={() => props.onCompile()}>
          {props.busy === '编译' ? tt('generating') : tt('compileAll')}
        </Btn>
      } />
      <div className="ad-row" style={{ marginBottom: 10 }}>
        {episode === undefined ? null : <Badge level={compiled === episode.shots.length && episode.shots.length > 0 ? 'ok' : 'info'}>{compiled}/{episode.shots.length} 已编译</Badge>}
        <span className="ad-tiny ad-muted">{DIALECTS.find(item => item.id === props.dialect)?.note}</span>
        {project.episodes.length > 1 ? (
          <Select value={episode?.id ?? ''} options={project.episodes.map(item => ({ value: item.id, label: `${item.id} ${item.title}` }))} onChange={props.setEpisodeId} />
        ) : null}
      </div>
      {episode?.shots.map(shot => (
        <div key={shot.id} className="ad-card" style={{ marginBottom: 10 }}>
          <div className="ad-card-title">
            <span className="ad-id">{shot.id}</span>
            <span>{shot.duration}s · {shot.size}</span>
            <span className="ad-spacer" />
            {shot.prompt.dialect === '' ? <Badge>{tt('noDialect')}</Badge> : <Badge level="info">{shot.prompt.dialect}</Badge>}
            <Btn onClick={() => props.onCompile(shot.id)} disabled={props.busy !== ''}>{tt('compile')}</Btn>
            <Btn onClick={() => { void navigator.clipboard?.writeText(shot.prompt.text) }}>{tt('copy')}</Btn>
          </div>
          {shot.prompt.text === ''
            ? <p className="ad-muted ad-tiny">尚未编译。点「编译」按 {props.dialect} 生成可复制正文。</p>
            : <pre className="ad-code" style={{ marginTop: 8 }}>{shot.prompt.text}</pre>}
          {shot.prompt.warnings.length === 0 ? null : (
            <div className="ad-col" style={{ marginTop: 8 }}>
              {shot.prompt.warnings.map((warning, index) => (
                <div key={index} className="ad-finding" data-level="warn"><Badge level="warn">警告</Badge><span>{warning}</span></div>
              ))}
            </div>
          )}
        </div>
      ))}
      {props.findings.filter(item => item.level === 'error').length > 0 ? (
        <>
          <h3 className="ad-h2">阻断项</h3>
          <Findings findings={props.findings.filter(item => item.level === 'error')} />
        </>
      ) : null}
    </div>
  )
}

export function ProductionPanel(props: { project: Project, mutate: Mutate }) {
  const { project, mutate } = props
  const total = project.jobs.reduce((sum, job) => sum + job.costCny, 0)
  return (
    <div>
      <SectionTitle title="生产" hint="v0.1 只出任务单与台账；生成图片/视频在路线图里。" actions={
        <Btn onClick={() => mutate(draft => {
          const shotId = draft.episodes[0]?.shots[0]?.id ?? ''
          draft.jobs.push({
            id: `JOB-${Date.now()}`, kind: 'image', shotId, status: 'pending', providerTaskId: '',
            costCny: 0, startedAt: Date.now(), endedAt: 0, note: '手动登记',
          })
          draft.ledger.push({ at: Date.now(), shotId, event: 'job-created', detail: '手动登记任务', costCny: 0 })
        })}>{tt('add')}任务</Btn>
      } />
      <div className="ad-row" style={{ marginBottom: 10 }}>
        <Badge level="info">任务 {project.jobs.length}</Badge>
        <Badge level={total > 0 ? 'warn' : 'info'}>记录成本 ¥{total.toFixed(2)}</Badge>
        <span className="ad-tiny ad-muted">记录口径 ≠ 供应商账单口径；导出时并列。</span>
      </div>
      <table className="ad-table">
        <thead><tr><th>类型</th><th>镜头</th><th>状态</th><th>上游任务</th><th>成本</th><th>备注</th><th /></tr></thead>
        <tbody>
          {project.jobs.map((job, index) => (
            <tr key={job.id}>
              <td><Select value={job.kind} options={['image', 'video', 'tts', 'music'].map(value => ({ value, label: value }))}
                onChange={value => mutate(draft => { const target = draft.jobs[index]; if (target !== undefined) target.kind = value as typeof target.kind })} /></td>
              <td><Input value={job.shotId} onChange={value => mutate(draft => { const target = draft.jobs[index]; if (target !== undefined) target.shotId = value })} /></td>
              <td><Select value={job.status} options={['pending', 'running', 'done', 'failed', 'cancelled'].map(value => ({ value, label: value }))}
                onChange={value => mutate(draft => { const target = draft.jobs[index]; if (target !== undefined) target.status = value as typeof target.status })} /></td>
              <td><Input value={job.providerTaskId} onChange={value => mutate(draft => { const target = draft.jobs[index]; if (target !== undefined) target.providerTaskId = value })} /></td>
              <td style={{ width: 90 }}><Input value={String(job.costCny)} onChange={value => mutate(draft => { const target = draft.jobs[index]; if (target !== undefined) target.costCny = Number(value) || 0 })} /></td>
              <td><Input value={job.note} onChange={value => mutate(draft => { const target = draft.jobs[index]; if (target !== undefined) target.note = value })} /></td>
              <td><Btn kind="ghost" onClick={() => mutate(draft => { draft.jobs.splice(index, 1) })}>×</Btn></td>
            </tr>
          ))}
        </tbody>
      </table>
      {project.jobs.length === 0 ? <p className="ad-muted">还没有任务。真实的视频生成接入后，这里会按「镜 → 生产单元 → 覆盖 → 素材」记录。</p> : null}
    </div>
  )
}

export function QcPanel(props: {
  project: Project
  validation: ValidationResult | undefined
  onValidate: () => void
  onExport: () => void
  onSelect: (finding: Finding) => void
  busy: string
}) {
  return (
    <div>
      <SectionTitle title="质检" hint="能判定的做成硬闸，不能判定的做成待办。" actions={
        <div className="ad-row">
          <Btn onClick={props.onValidate} disabled={props.busy !== ''}>{tt('validate')}</Btn>
          <Btn kind="primary" onClick={props.onExport} disabled={props.busy !== ''}>{tt('export')}</Btn>
        </div>
      } />
      {props.validation === undefined ? <p className="ad-muted">点「校验」跑一遍规则。</p> : (
        <>
          <div className="ad-row" style={{ marginBottom: 10 }}>
            <Badge level={props.validation.errors > 0 ? 'error' : 'ok'}>{props.validation.errors} error</Badge>
            <Badge level={props.validation.warns > 0 ? 'warn' : 'info'}>{props.validation.warns} warn</Badge>
            <span className="ad-tiny ad-muted">检查于 {new Date(props.validation.checkedAt).toLocaleTimeString('zh-CN')}</span>
          </div>
          <Findings findings={props.validation.findings} onSelect={props.onSelect} />
        </>
      )}
      <h3 className="ad-h2">导出</h3>
      <p className="ad-note">导出会把 project.json 与五份 Markdown（总纲、视觉设定、剧本、分镜、提示词、台账）写到项目目录的 exports/ 下，可直接交给 drama-skills 或人工接手。</p>
      <h3 className="ad-h2">生成前检查</h3>
      <div className="ad-col ad-tiny">
        <span>□ 每镜只有一个主动作，首帧只画动作开始前状态</span>
        <span>□ 台词字数 / 4 ≤ 镜头时长 − 0.5 秒</span>
        <span>□ 参考图四态明确；PLAN 不能直接投产</span>
        <span>□ 锁面逐字出现在编译正文里</span>
        <span>□ 目标模型的原生时长区间对得上</span>
        <span>□ 无配乐镜写 N/A；默认禁字幕时正文明确写</span>
      </div>
    </div>
  )
}
