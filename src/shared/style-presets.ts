import type { Project, StyleAnchor } from './types.ts'

type Preset = {
  medium: string
  palette: string
  lighting: string
  lens: string
  texture: string
  avoid: string[]
}

const PRESETS: Record<Project['meta']['genre'], Preset> = {
  costume: {
    medium: '架空古装电影写实，细腻 3D 国风材质，布料与金属有真实磨损',
    palette: '宫宴鎏金暖光 / 天牢青灰冷光，冷暖对冲，低饱和电影色',
    lighting: '宫宴用鎏金暖光与烛火侧光；天牢用青灰冷光、硬质顶光与石壁反光',
    lens: '竖屏中近景为主；越肩、低机位仰拍制造权力压迫，关键情绪用特写',
    texture: '布料起毛、金属哑光、皮肤保留纹理；轻微胶片颗粒；不磨皮',
    avoid: ['水印', 'Logo', '字幕', '现代元素', '网红磨皮', '血腥特写'],
  },
  xianxia: {
    medium: '东方仙侠电影写实，体积云、灵气粒子与高精度材质',
    palette: '青绿山水为底，金白灵气点染，暗部偏墨青',
    lighting: '天光逆光、山雾体积光；法阵用低饱和金青自发光',
    lens: '大远景建立山水尺度，中近景跟人物；缓慢横移与俯仰',
    texture: '丝绸、玉石、雾气质感；高光不溢出，暗部保留层次',
    avoid: ['水印', 'Logo', '字幕', '现代元素', '塑料感', '过曝仙境'],
  },
  urban: {
    medium: '都市写实电影，自然光与真实城市材质',
    palette: '中性灰蓝为底，室内暖光点染，夜景霓虹做局部对比',
    lighting: '窗光与实用光源为主，夜景用路灯与招牌冷暖混合',
    lens: '中近景为主，手持感轻微；对话用越肩，压迫时低机位',
    texture: '真实皮肤、棉麻与玻璃反光；轻微颗粒；不过度磨皮',
    avoid: ['水印', 'Logo', '字幕', '过度滤镜', '网红磨皮', '广告感'],
  },
  suspense: {
    medium: '冷调悬疑电影写实，低照度与高对比',
    palette: '冷青灰为底，暗红/钠黄做危险点色',
    lighting: '单一硬光源、长阴影；走廊与雨夜用反光地面',
    lens: '中近景与特写为主；固定机位、缓慢推近；避免炫技运镜',
    texture: '潮湿墙面、粗糙皮肤、低饱和；明显但克制的颗粒',
    avoid: ['水印', 'Logo', '字幕', '现代logo', '高饱和', '滑稽表情'],
  },
  scifi: {
    medium: '近未来科幻电影写实，工业材质与洁净界面',
    palette: '冷白与深空灰为底，青蓝/橙色做功能光',
    lighting: '大面积柔光与硬边轮廓光；屏幕光参与人物照明',
    lens: '广角建立空间，长焦压缩；稳定器与缓慢轨道',
    texture: '金属拉丝、玻璃反射、雾面塑料；界面文字后期叠加',
    avoid: ['水印', 'Logo', '字幕', '赛博朋克堆砌', '过饱和霓虹'],
  },
  realism: {
    medium: '现实主义电影写实，自然光与纪实质感',
    palette: '低饱和自然色，肤色准确，环境色统一',
    lighting: '自然窗光与现场实用光，避免戏剧化打光',
    lens: '中景与中近景，轻微手持；尊重人物视线与空间',
    texture: '真实皮肤、旧布料、灰尘；轻颗粒；不美颜',
    avoid: ['水印', 'Logo', '字幕', '广告滤镜', '网红磨皮', '戏剧化光效'],
  },
  family: {
    medium: '温暖家庭剧写实，柔和自然材质',
    palette: '米白、木色与暖黄为底，低对比',
    lighting: '窗光与台灯暖光，柔化阴影',
    lens: '中近景为主，平视视角；缓慢推拉',
    texture: '棉布、木纹、生活痕迹；柔和颗粒',
    avoid: ['水印', 'Logo', '字幕', '过度美颜', '冷硬广告光'],
  },
  sweet: {
    medium: '清新甜宠剧写实，明亮柔和材质',
    palette: '奶油白、浅粉与薄荷绿，低饱和高明度',
    lighting: '大面积柔光与逆光轮廓，眼神光清晰',
    lens: '中近景与特写，平视或轻微仰拍；轻柔跟拍',
    texture: '干净皮肤但保留纹理、纱质与毛绒；轻颗粒',
    avoid: ['水印', 'Logo', '字幕', '过度磨皮', '高饱和糖水色'],
  },
  comedy: {
    medium: '明亮轻喜剧写实，清晰色彩与利落构图',
    palette: '暖黄与青绿搭配，高亮低对比',
    lighting: '均匀柔光，减少恐怖阴影；表情清楚',
    lens: '中景为主，固定或轻快跟拍；反应镜头用中近景',
    texture: '真实但干净，布料与道具清晰；轻颗粒',
    avoid: ['水印', 'Logo', '字幕', '阴间滤镜', '过度美颜'],
  },
}

export function defaultStyle(project: Project): StyleAnchor {
  const preset = PRESETS[project.meta.genre] ?? PRESETS.urban
  return {
    id: 'STYLE_A',
    name: `${project.meta.genre === 'costume' ? '古装' : '主风格'} · 默认提案`,
    prompt: project.bible.visualDirection.trim() || preset.medium,
    avoid: [...preset.avoid],
    status: 'proposed',
    medium: preset.medium,
    palette: preset.palette,
    lighting: preset.lighting,
    lens: preset.lens,
    texture: preset.texture,
    referenceImage: '',
  }
}

/** 只填缺失字段；已有内容不被覆盖，status 保持用户选择。 */
export function fillStyleDefaults(project: Project): void {
  const preset = defaultStyle(project)
  if (project.styles.length === 0) {
    project.styles.push(preset)
    return
  }
  const style = project.styles[0]
  if (style === undefined) return
  style.status ??= 'proposed'
  style.medium ||= preset.medium
  style.palette ||= preset.palette
  style.lighting ||= preset.lighting
  style.lens ||= preset.lens
  style.texture ||= preset.texture
  if (style.avoid.length === 0) style.avoid = [...preset.avoid]
  if (style.prompt.trim() === '') style.prompt = preset.prompt
}
