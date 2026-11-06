/** 右栏检查器：角色九槽、镜头、场景、道具、风格锚。 */

import type { Character, Episode, Project, Prop, Scene, Shot, ShotRef, StyleAnchor } from '../shared/types.ts'
import { tt } from './locale.ts'
import {
  Area, Badge, Btn, Field, Input, REF_ROLES, REF_STATES, Select, ZoomImage, renderLock, type Mutate,
} from './ui.tsx'

function parseEpisodeList(value: string): string[] {
  return [...new Set(value.split(/[,，、\s]+/).map(item => item.trim()).filter(item => item !== ''))]
}

export function CharacterInspector(props: {
  character: Character
  mutate: Mutate
  busy: string
  audioUrl: (path: string) => string
  imageUrl: (path: string) => string
  onDesignVoice: (characterId: string, description: string, sampleText: string) => void
  onGenerateImage: (characterId: string, view?: 'front' | 'side' | 'back' | 'sheet', prompt?: string) => void
  onGenerateLookImage: (characterId: string, lookId: string, view: 'front' | 'side' | 'back' | 'sheet', prompt?: string) => void
}) {
  const { character } = props
  const patch = (fn: (character: Character) => void): void => {
    props.mutate(draft => {
      const target = draft.characters.find(item => item.id === character.id)
      if (target !== undefined) fn(target)
    })
  }
  const locked = character.status === 'locked'
  const slot = (key: keyof Character['slots'], label: string): JSX.Element => (
    <Field label={label}>
      <Area rows={2} value={character.slots[key]} disabled={locked}
        onChange={value => patch(draft => { draft.slots[key] = value })} />
    </Field>
  )
  return (
    <div className="ad-col">
      <div className="ad-row">
        <h3 className="ad-h2" style={{ margin: 0 }}>{character.id}</h3>
        <span className="ad-spacer" />
        <Btn onClick={() => patch(draft => {
          draft.status = draft.status === 'locked' ? 'draft' : 'locked'
          if (draft.status === 'locked' && draft.lockText.trim() === '') draft.lockText = renderLock(draft)
        })}>{locked ? tt('unlock') : tt('lock')}</Btn>
      </div>
      <Field label="名字"><Input value={character.name} onChange={value => patch(draft => { draft.name = value })} /></Field>
      <Field label="出现集数（共享资产引用，逗号分隔）"><Input value={(character.appearsIn ?? []).join('、')} onChange={value => patch(draft => { draft.appearsIn = parseEpisodeList(value) })} /></Field>
      <Field label="定位"><Input value={character.role} onChange={value => patch(draft => { draft.role = value })} /></Field>
      {(character.roleEvidence ?? []).length === 0 ? null : (
        <div className="ad-card" style={{ padding: 8 }}>
          <div className="ad-tiny ad-muted">定位证据</div>
          {(character.roleEvidence ?? []).map((line, index) => <p key={index} className="ad-tiny" style={{ margin: '2px 0' }}>{line}</p>)}
        </div>
      )}
      <h3 className="ad-h2">基础参考图（无 LOOK 时兜底）</h3>
      <div className="ad-col" style={{ borderBottom: '1px solid var(--dsw-alias-border-l1)', paddingBottom: 8 }}>
        <div className="ad-row">
          <span className="ad-tiny" style={{ minWidth: 60 }}>合一</span>
          <Btn onClick={() => props.onGenerateImage(character.id, 'sheet', character.refPrompts.sheet)} disabled={props.busy !== ''}>
            {props.busy === `imagegen:${character.id}` ? '生成中…' : character.refs.main === '' ? '生成三视图' : '重抽三视图'}
          </Btn>
          {character.refs.main === '' ? null : <span className="ad-tiny ad-muted">{character.refs.main}</span>}
        </div>
        <Input value={character.refPrompts.sheet} placeholder="留空 = 用锁面自动拼三视图提示词"
          onChange={value => patch(draft => { draft.refPrompts.sheet = value })} />
        {character.refs.main === '' ? null : (
          <ZoomImage src={props.imageUrl(character.refs.main)} alt={`${character.name} 三视图`} style={{ width: '100%', borderRadius: 8 }} />
        )}
      </div>
      {(['front', 'side', 'back'] as const).map(view => (
        <div key={view} className="ad-col" style={{ borderBottom: '1px solid var(--dsw-alias-border-l1)', paddingBottom: 8 }}>
          <div className="ad-row">
            <span className="ad-tiny" style={{ minWidth: 44 }}>{view === 'front' ? '正视' : view === 'side' ? '侧视' : '背视'}</span>
            <Btn onClick={() => props.onGenerateImage(character.id, view, character.refPrompts[view])} disabled={props.busy !== ''}>
              {props.busy === `imagegen:${character.id}` ? '生成中…' : character.refs[view] === '' ? '生成' : '重抽'}
            </Btn>
            {character.refs[view] === '' ? null : <span className="ad-tiny ad-muted">{character.refs[view]}</span>}
          </div>
          <Input value={character.refPrompts[view]} placeholder="留空 = 用锁面自动拼提示词"
            onChange={value => patch(draft => { draft.refPrompts[view] = value })} />
          {character.refs[view] === '' ? null : (
            <ZoomImage src={props.imageUrl(character.refs[view])} alt={`${character.name} ${view}`} style={{ width: '100%', borderRadius: 8 }} />
          )}
        </div>
      ))}
      <div className="ad-grid2">
        {slot('ageGender', '年龄性别')}
        {slot('face', '脸型五官')}
        {slot('hair', '发型发色')}
        {slot('body', '体型身高')}
        {slot('outfit', '服装（LOOK-01）')}
        {slot('accessories', '配饰')}
        {slot('temperament', '气质')}
        {slot('forbidden', '禁改项')}
      </div>
      {slot('lightBaseline', '光线基准')}
      <Field label={tt('lockText')}>
        <Area rows={3} value={character.lockText} disabled={locked} onChange={value => patch(draft => { draft.lockText = value })} />
      </Field>
      <Field label="身份锁（不含服装）">
        <Area rows={3} value={character.identityLock} disabled={locked} placeholder="脸/发型/体型/气质/禁改项；留空则用九槽自动拼"
          onChange={value => patch(draft => { draft.identityLock = value })} />
      </Field>
      <div className="ad-row">
        <Btn disabled={locked} onClick={() => patch(draft => { draft.lockText = renderLock(draft) })}>由九槽重算锁面</Btn>
        <Btn onClick={() => { void navigator.clipboard?.writeText(character.lockText) }}>{tt('copy')}</Btn>
      </div>

      <h3 className="ad-h2">造型 LOOK（按镜头切换）</h3>
      {character.looks.length === 0 ? (
        <p className="ad-note">还没有 LOOK。默认用「服装」槽生成 LOOK-01；添加后可在分镜里按镜头切换。</p>
      ) : null}
      {character.looks.map((look, index) => (
        <div key={look.id} className="ad-card ad-col">
          <div className="ad-row">
            <strong>{look.id}</strong>
            <span className="ad-spacer" />
            <Btn kind="ghost" onClick={() => patch(draft => { draft.looks.splice(index, 1) })}>移除</Btn>
          </div>
          <Field label="造型描述（服装/配饰/妆造）">
            <Area rows={2} value={look.text} onChange={value => patch(draft => { const target = draft.looks[index]; if (target !== undefined) target.text = value })} />
          </Field>
          <Field label="适用集数（逗号分隔，留空=默认）">
            <Input value={look.episodes.join(', ')} placeholder="EP001, EP002"
              onChange={value => patch(draft => {
                const target = draft.looks[index]
                if (target !== undefined) target.episodes = value.split(',').map(item => item.trim()).filter(Boolean)
              })} />
          </Field>
          <Field label="造型提示词（抽图用；留空=用造型描述）">
            <Input value={look.refPrompts.sheet} placeholder="留空则用造型描述 + 身份锁"
              onChange={value => patch(draft => { const target = draft.looks[index]; if (target !== undefined) target.refPrompts.sheet = value })} />
          </Field>
          <div className="ad-row">
            {(['front', 'side', 'back', 'sheet'] as const).map(view => (
              <Btn key={view} onClick={() => props.onGenerateLookImage(character.id, look.id, view, look.refPrompts.sheet || look.text)}
                disabled={props.busy !== ''}>
                {view === 'front' ? '抽正视' : view === 'side' ? '抽侧视' : view === 'back' ? '抽背视' : '抽三视图'}
              </Btn>
            ))}
          </div>
          <div className="ad-row">
            {(['front', 'side', 'back'] as const).map(view => (
              look.refs[view] === '' ? null : (
                <ZoomImage key={view} src={props.imageUrl(look.refs[view])} alt={`${character.name} ${look.id} ${view}`}
                  style={{ width: '31%', borderRadius: 6 }} />
              )
            ))}
            {look.refs.main === '' ? null : <ZoomImage src={props.imageUrl(look.refs.main)} alt={`${character.name} ${look.id}`} style={{ width: '100%', borderRadius: 6 }} />}
          </div>
        </div>
      ))}
      <Btn onClick={() => patch(draft => {
        let index = 1
        while (draft.looks.some(look => look.id === `LOOK-${String(index).padStart(2, '0')}`)) index += 1
        draft.looks.push({
          id: `LOOK-${String(index).padStart(2, '0')}`,
          text: index === 1 ? [draft.slots.outfit, draft.slots.accessories].filter(Boolean).join('；') : '',
          episodes: [],
          refs: { front: '', side: '', back: '', main: '' },
          refPrompts: { front: '', side: '', back: '', sheet: '' },
        })
      })}>添加 LOOK</Btn>

      <h3 className="ad-h2">状态链</h3>
      <Field label="状态链（一行一个：C01_state02 变化）">
        <Area rows={3} value={character.stateVariants.map(variant => `${variant.id} ${variant.change}`).join('\n')}
          onChange={value => patch(draft => {
            draft.stateVariants = value.split('\n').map((line, index) => {
              const [id, ...rest] = line.trim().split(' ')
              return { id: id || `C${index}_state`, change: rest.join(' '), fromShot: '', affects: [] }
            }).filter(variant => variant.change !== '')
          })} />
      </Field>
      <Field label="音色卡（voiceId | 年龄 | 语速 | 基线）">
        <Area rows={3} value={[character.voiceCard.voiceId, character.voiceCard.ageRange, character.voiceCard.rate, character.voiceCard.baseline].join(' | ')}
          onChange={value => patch(draft => {
            const [voiceId, ageRange, rate, baseline] = value.split('|').map(item => item.trim())
            draft.voiceCard = { ...draft.voiceCard, voiceId: voiceId ?? '', ageRange: ageRange ?? '', rate: rate ?? '', baseline: baseline ?? '' }
          })} />
      </Field>
      <h3 className="ad-h2">音色设计（MiMo voicedesign）</h3>
      <Field label="音色描述（年龄/性别/质感/口音/语速）">
        <Area rows={3} value={character.voiceCard.designPrompt}
          placeholder="例如：25 岁男性，低沉略哑，语速偏慢，句尾收住；不要播音腔"
          onChange={value => patch(draft => { draft.voiceCard.designPrompt = value })} />
      </Field>
      <Field label="试音文本">
        <Input value={character.voiceCard.sampleText} placeholder={`我是${character.name}。这句话用来确认我的音色。`}
          onChange={value => patch(draft => { draft.voiceCard.sampleText = value })} />
      </Field>
      <div className="ad-row">
        <Btn onClick={() => {
          const fallback = [character.voiceCard.ageRange, character.voiceCard.rate, character.voiceCard.baseline].filter(Boolean).join('；')
          props.onDesignVoice(character.id, character.voiceCard.designPrompt || fallback, character.voiceCard.sampleText)
        }} disabled={props.busy !== ''}>
          {props.busy === `voice:${character.id}` ? '正在设计…' : character.voiceCard.voiceSample === '' ? '设计角色音色' : '重抽音色'}
        </Btn>
        {character.voiceCard.voiceSample === '' ? null : <Badge level="ok">已绑定</Badge>}
        {character.voiceCard.voiceSample === '' ? null : <span className="ad-tiny ad-muted">{character.voiceCard.voiceSample}</span>}
      </div>
      {character.voiceCard.voiceSample === '' ? (
        <p className="ad-tiny ad-muted">生成一条样音后，这个角色在 Seedance 里会用它的音色生成对白。</p>
      ) : (
        <audio controls src={props.audioUrl(character.voiceCard.voiceSample)} style={{ width: '100%', height: 32 }} />
      )}
    </div>
  )
}

export function ShotInspector(props: {
  project: Project
  episode: Episode
  shot: Shot
  mutate: Mutate
  onCompile: (shotId: string) => void
  onGenerateImage: (shotId: string) => void
  onGenerateVideo: (shotId: string) => void
  onUploadImage: (shotId: string, file: File) => void
  busy: string
  assetUrl: (path: string) => string
}) {
  const { project, episode, shot } = props
  const wardrobeIds = new Set<string>(Object.keys(shot.wardrobe))
  for (const lock of shot.locks) {
    const match = /^LOCK-(C\d+)/i.exec(lock)
    if (match !== null) wardrobeIds.add(match[1]!)
  }
  for (const line of shot.dialogue) if (line.speaker !== '') wardrobeIds.add(line.speaker)
  const wardrobeCharacters = [...wardrobeIds]
    .map(id => project.characters.find(character => character.id === id))
    .filter((character): character is NonNullable<typeof character> => character !== undefined)
  const patch = (fn: (shot: Shot) => void): void => {
    props.mutate(draft => {
      const target = draft.episodes.find(item => item.id === episode.id)?.shots.find(item => item.id === shot.id)
      if (target !== undefined) fn(target)
    })
  }
  const lockOptions = project.characters.map(character => ({ value: `LOCK-${character.id}-LOCK`, label: `${character.id} ${character.name} 锁面` }))
  return (
    <div className="ad-col">
      <div className="ad-row">
        <h3 className="ad-h2" style={{ margin: 0 }}>{shot.id}</h3>
        <span className="ad-spacer" />
        <Badge level={shot.status === 'compiled' ? 'ok' : 'info'}>{shot.status}</Badge>
        <Btn onClick={() => props.onCompile(shot.id)} disabled={props.busy !== ''}>{tt('compile')}</Btn>
      </div>
      <div className="ad-row">
        <input type="file" accept="image/png,image/jpeg,image/webp" style={{ maxWidth: 180 }}
          onChange={event => {
            const file = event.target.files?.[0]
            if (file !== undefined) props.onUploadImage(shot.id, file)
          }} />
        <Btn onClick={() => props.onGenerateImage(shot.id)} disabled={props.busy !== ''}>
          {props.busy === `imagegen:${shot.id}` ? '生成中…' : '生成首帧'}
        </Btn>
        <Btn onClick={() => props.onGenerateVideo(shot.id)} disabled={props.busy !== ''}>
          {props.busy === `video:${shot.id}` ? '生成中…' : '生成对白视频'}
        </Btn>
      </div>
      <p className="ad-tiny ad-muted">Seedance 2.0 会用说话角色的音色样音作 reference_audio；需要一张参考图（上传首帧或填参考槽路径）。</p>
      {shot.videoPath === '' ? null : <video controls src={props.assetUrl(shot.videoPath)} style={{ width: '100%', borderRadius: 8 }} />}
      <div className="ad-grid2">
        <Field label="时长（秒，4–15）"><Input value={String(shot.duration)} onChange={value => patch(draft => { draft.duration = Math.max(4, Math.min(15, Number(value) || 4)) })} /></Field>
        <Field label="景别"><Select value={shot.size} options={['establishing', 'wide', 'medium', 'close', 'extreme-close'].map(value => ({ value, label: value }))}
          onChange={value => patch(draft => { draft.size = value })} /></Field>
      </div>
      <Field label="场景"><Select value={shot.sceneId} options={project.scenes.map(scene => ({ value: scene.id, label: `${scene.id} ${scene.name}` }))}
        onChange={value => patch(draft => { draft.sceneId = value })} /></Field>
      <Field label="运镜"><Input value={shot.camera} onChange={value => patch(draft => { draft.camera = value })} /></Field>
      <Field label="站位 / 视线"><Input value={shot.blocking} onChange={value => patch(draft => { draft.blocking = value })} /></Field>
      <Field label="唯一主动作"><Area rows={3} value={shot.action} onChange={value => patch(draft => { draft.action = value })} /></Field>
      <Field label="终点 / 结束画面"><Input value={shot.endState} onChange={value => patch(draft => { draft.endState = value })} /></Field>
      <div className="ad-grid2">
        <Field label="情绪起点"><Input value={shot.emotion.start} onChange={value => patch(draft => { draft.emotion.start = value })} /></Field>
        <Field label="触发"><Input value={shot.emotion.trigger} onChange={value => patch(draft => { draft.emotion.trigger = value })} /></Field>
      </div>
      <Field label="情绪终点"><Input value={shot.emotion.end} onChange={value => patch(draft => { draft.emotion.end = value })} /></Field>

      <h3 className="ad-h2">造型（服装）</h3>
      {wardrobeCharacters.length === 0 ? <p className="ad-note">先给这镜加角色锁或台词说话人，才能绑定 LOOK。</p> : null}
      {wardrobeCharacters.map(character => {
        const looks = character.looks.length > 0
          ? character.looks
          : [{ id: 'LOOK-01', text: [character.slots.outfit, character.slots.accessories].filter(Boolean).join('；') }]
        const selected = shot.wardrobe[character.id] ?? ''
        return (
          <Field key={character.id} label={`${character.id} ${character.name}`}>
            <div className="ad-row">
              <Select value={selected} options={[
                { value: '', label: `默认（${looks[0]?.id ?? 'LOOK-01'}）` },
                ...looks.map(look => ({ value: look.id, label: `${look.id} ${look.text.slice(0, 24)}` })),
              ]} onChange={value => patch(draft => {
                if (value === '') delete draft.wardrobe[character.id]
                else draft.wardrobe[character.id] = value
              })} />
              <span className="ad-tiny ad-muted">{looks.find(look => look.id === selected)?.text ?? looks[0]?.text ?? ''}</span>
            </div>
          </Field>
        )
      })}

      <h3 className="ad-h2">台词</h3>
      {shot.dialogue.map((line, index) => (
        <div key={index} className="ad-row">
          <Select value={line.speaker} options={[{ value: '', label: '说话人' }, ...project.characters.map(character => ({ value: character.id, label: character.id }))]}
            onChange={value => patch(draft => { const target = draft.dialogue[index]; if (target !== undefined) target.speaker = value })} />
          <div style={{ flex: 1, minWidth: 80 }}><Input value={line.text} onChange={value => patch(draft => { const target = draft.dialogue[index]; if (target !== undefined) target.text = value })} /></div>
          <Btn kind="ghost" onClick={() => patch(draft => { draft.dialogue.splice(index, 1) })}>×</Btn>
        </div>
      ))}
      <Btn onClick={() => patch(draft => { draft.dialogue.push({ speaker: project.characters[0]?.id ?? '', text: '', offScreen: false, voiceOver: false }) })}>{tt('add')}台词</Btn>

      <h3 className="ad-h2">参考图（四态）</h3>
      {shot.refs.map((ref, index) => (
        <div key={index} className="ad-card" style={{ padding: 8 }}>
          <div className="ad-row">
            <Input value={ref.slot} onChange={value => patch(draft => { const target = draft.refs[index]; if (target !== undefined) target.slot = value })} />
            <Select value={ref.state} options={REF_STATES.map(value => ({ value, label: value }))}
              onChange={value => patch(draft => { const target = draft.refs[index]; if (target !== undefined) target.state = value as ShotRef['state'] })} />
            <Select value={ref.role} options={REF_ROLES.map(value => ({ value, label: value }))}
              onChange={value => patch(draft => { const target = draft.refs[index]; if (target !== undefined) target.role = value as ShotRef['role'] })} />
            <Btn kind="ghost" onClick={() => patch(draft => { draft.refs.splice(index, 1) })}>×</Btn>
          </div>
          <div className="ad-row" style={{ marginTop: 6 }}>
            <div style={{ flex: 1, minWidth: 100 }}><Input value={ref.path} placeholder="文件路径"
              onChange={value => patch(draft => { const target = draft.refs[index]; if (target !== undefined) target.path = value })} /></div>
            <div style={{ flex: 1, minWidth: 100 }}><Input value={ref.note} placeholder="用途备注"
              onChange={value => patch(draft => { const target = draft.refs[index]; if (target !== undefined) target.note = value })} /></div>
          </div>
        </div>
      ))}
      <Btn onClick={() => patch(draft => { draft.refs.push({ slot: `REF-${draft.refs.length + 1}`, state: 'plan', role: 'identity', path: '', note: '' }) })}>{tt('add')}参考槽</Btn>

      <h3 className="ad-h2">连续性锁</h3>
      <Select value="" options={[{ value: '', label: '添加角色锁…' }, ...lockOptions]}
        onChange={value => { if (value !== '') patch(draft => { if (!draft.locks.includes(value)) draft.locks.push(value) }) }} />
      {shot.locks.map((lock, index) => (
        <div key={lock} className="ad-row">
          <span className="ad-tiny">{lock}</span>
          <span className="ad-spacer" />
          <Btn kind="ghost" onClick={() => patch(draft => { draft.locks.splice(index, 1) })}>移除</Btn>
        </div>
      ))}
      {shot.prompt.text === '' ? null : <pre className="ad-code">{shot.prompt.text}</pre>}
    </div>
  )
}

export function SceneInspector(props: {
  scene: Scene
  mutate: Mutate
  busy: string
  imageUrl: (path: string) => string
  onGenerateImage: (sceneId: string) => void
}) {
  const patch = (fn: (scene: Scene) => void): void => {
    props.mutate(draft => { const target = draft.scenes.find(item => item.id === props.scene.id); if (target !== undefined) fn(target) })
  }
  return (
    <div className="ad-col">
      <h3 className="ad-h2" style={{ margin: 0 }}>{props.scene.id}</h3>
      <Field label="名字"><Input value={props.scene.name} onChange={value => patch(draft => { draft.name = value })} /></Field>
      <Field label="出现集数（共享资产引用，逗号分隔）"><Input value={(props.scene.appearsIn ?? []).join('、')} onChange={value => patch(draft => { draft.appearsIn = parseEpisodeList(value) })} /></Field>
      <div className="ad-row">
        <Btn onClick={() => props.onGenerateImage(props.scene.id)} disabled={props.busy !== ''}>
          {props.busy === `imagegen:${props.scene.id}` ? '生成中…' : '生成场景参考图'}
        </Btn>
        {props.scene.refImage === '' ? null : <span className="ad-tiny ad-muted">{props.scene.refImage}</span>}
      </div>
      {props.scene.refImage === '' ? null : <ZoomImage src={props.imageUrl(props.scene.refImage)} alt={props.scene.name} style={{ width: '100%', borderRadius: 8 }} />}
      <Field label="空间结构"><Area rows={4} value={props.scene.space} onChange={value => patch(draft => { draft.space = value })} /></Field>
      <Field label="固定道具"><Input value={props.scene.props} onChange={value => patch(draft => { draft.props = value })} /></Field>
      <Field label="色调"><Input value={props.scene.palette} onChange={value => patch(draft => { draft.palette = value })} /></Field>
      <Field label="主光源"><Input value={props.scene.keyLight} onChange={value => patch(draft => { draft.keyLight = value })} /></Field>
    </div>
  )
}

export function PropInspector(props: {
  prop: Prop
  mutate: Mutate
  busy: string
  imageUrl: (path: string) => string
  onGenerateImage: (propId: string) => void
}) {
  const patch = (fn: (prop: Prop) => void): void => {
    props.mutate(draft => { const target = draft.props.find(item => item.id === props.prop.id); if (target !== undefined) fn(target) })
  }
  return (
    <div className="ad-col">
      <h3 className="ad-h2" style={{ margin: 0 }}>{props.prop.id}</h3>
      <Field label="名字"><Input value={props.prop.name} onChange={value => patch(draft => { draft.name = value })} /></Field>
      <Field label="出现集数（共享资产引用，逗号分隔）"><Input value={(props.prop.appearsIn ?? []).join('、')} onChange={value => patch(draft => { draft.appearsIn = parseEpisodeList(value) })} /></Field>
      <div className="ad-row">
        <Btn onClick={() => props.onGenerateImage(props.prop.id)} disabled={props.busy !== ''}>
          {props.busy === `imagegen:${props.prop.id}` ? '生成中…' : '生成道具参考图'}
        </Btn>
        {props.prop.refImage === '' ? null : <span className="ad-tiny ad-muted">{props.prop.refImage}</span>}
      </div>
      {props.prop.refImage === '' ? null : <ZoomImage src={props.imageUrl(props.prop.refImage)} alt={props.prop.name} style={{ width: '100%', borderRadius: 8 }} />}
      <Field label="功能"><Select value={props.prop.function} options={['evidence', 'identity', 'countdown', 'keepsake', 'obstacle'].map(value => ({ value, label: value }))}
        onChange={value => patch(draft => { draft.function = value as Prop['function'] })} /></Field>
      <Field label="外观"><Area rows={3} value={props.prop.appearance} onChange={value => patch(draft => { draft.appearance = value })} /></Field>
      <Field label="持有者"><Input value={props.prop.owner} onChange={value => patch(draft => { draft.owner = value })} /></Field>
      <Field label="结束位置"><Input value={props.prop.endPosition} onChange={value => patch(draft => { draft.endPosition = value })} /></Field>
    </div>
  )
}

export function StyleInspector(props: { style: StyleAnchor, mutate: Mutate }) {
  const patch = (fn: (style: StyleAnchor) => void): void => {
    props.mutate(draft => { const target = draft.styles.find(item => item.id === props.style.id); if (target !== undefined) fn(target) })
  }
  return (
    <div className="ad-col">
      <h3 className="ad-h2" style={{ margin: 0 }}>{props.style.id}</h3>
      <Field label="名字"><Input value={props.style.name} onChange={value => patch(draft => { draft.name = value })} /></Field>
      <Field label="风格提示词"><Area rows={5} value={props.style.prompt} onChange={value => patch(draft => { draft.prompt = value })} /></Field>
      <Field label="禁用（一行一条）"><Area rows={3} value={props.style.avoid.join('\n')}
        onChange={value => patch(draft => { draft.avoid = value.split('\n').map(item => item.trim()).filter(Boolean) })} /></Field>
    </div>
  )
}
