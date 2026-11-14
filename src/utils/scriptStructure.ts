// 剧本结构与对白校验（⑯-1，2026-11-09）
//
// 这是诗歌那套「形式」维度（⑩⑪）在戏剧里的对应物。诗歌要的是言数 / 音节 / 节结构；
// 戏剧要的是**幕场结构、谁在说话、这段舞台指示演不演得出来**。
// 没有这一层，剧本体裁就只是一个换了名字的小说编辑器 —— 而这正是李先生从第一天就在问的
// 「这四个题材凭什么不一样」。
//
// 三条纪律（与诗歌同一套，不是抄来的口号，是被测试教育出来的）：
// 1. **只解析，不改正文**：本模块纯函数，不碰编辑器渲染链路（排版属承载层，未批不动）；
// 2. **估算与硬判定分家**：长台词（独白）阈值是经验值，只作提示 `advisory`，
//    绝不与「有没有幕场标题」「这段有没有人说话」这类硬事实同色同权重；
// 3. **宁可不判**：认不出的行归 `prose`（散文体信号），不猜它是台词还是指示。
import { htmlContentBlocks, countWrittenUnits, countWords, hasCjkText } from './contentBlocks';

export type ScriptBlockKind = 'act' | 'scene' | 'dialogue' | 'direction' | 'prose';

export interface ScriptBlock {
  /** 块序号（0-based，与正文块顺序一致，供跳转定位） */
  index: number;
  kind: ScriptBlockKind;
  /** 幕/场标题的原始序号串（'第二幕' / 'ACT II' / '第 3 场'）；非标题为 '' */
  label: string;
  /** 对白说话人；非对白为 '' */
  speaker: string;
  text: string;
  /** 去标点的字数（中文口径） */
  units: number;
  /** 词数（英文口径） */
  words: number;
}

export interface ScriptSpeakerStat {
  name: string;
  lines: number;
  units: number;
  /** 台词量占全剧比例（0-1） */
  share: number;
}

export interface ScriptStructure {
  blocks: ScriptBlock[];
  acts: number;
  scenes: number;
  /** 每一场的对白行数，按出现顺序；全书没有场标题时整本算一场 */
  sceneDialogueLines: number[];
  /** 一句台词都没有的场（1-based）—— 戏剧里这通常是"这场还没写" */
  silentScenes: number[];
  speakers: ScriptSpeakerStat[];
  dialogueLines: number;
  directionLines: number;
  /** 既不像对白也不像舞台指示的正文块（含布景行、时间行 —— 那些是合法的，别当缺陷） */
  proseBlocks: number;
  /**
   * **长**叙述段：布景行「鲁贵公馆的客厅」只有几个字，而"黄昏时分，客厅里很暗，四凤站在
   * 窗前等着"是一整段小说写法。只用长度把两者分开，否则一句布景就报预警（⑯-1 第一版就犯了这个，
   * 测试还是我自己写的，绿得很顺 —— 假阳性没被打出来不代表没有）。
   */
  narrativeBlocks: number;
  /** 超阈值的长台词（独白）—— **advisory**，不是缺陷 */
  monologues: { speaker: string; index: number; units: number; words: number }[];
  /** 一个幕/场标题都没认出来 */
  hasHeadings: boolean;
  /** 传了角色表时：台上说了话但表里没这个人 */
  unknownSpeakers: string[];
  cjk: boolean;
}

/** 中文幕标：第二幕 / 第 3 幕 / 第三折 / 序幕 / 楔子 */
const ACT_ZH = /^\s*(第\s*[〇零一二两三四五六七八九十百千0-9]{1,6}\s*[幕折]|序幕|楔子|楔末)\s*$/;
/** 中文场标：第 3 场 / 第三景 */
const SCENE_ZH = /^\s*第\s*[〇零一二两三四五六七八九十百千0-9]{1,6}\s*[场景]\s*$/;
/** 英文幕场标：ACT II / Act 3 / SCENE 4 / SC. 2 */
const ACT_EN = /^\s*(ACT|AKT)\s+[IVXLCDM0-9]{1,7}\b/i;
const SCENE_EN = /^\s*(SCENE|SC\.)\s*[IVXLCDM0-9]{1,7}\b/i;
/** 幕/场标题后面可能紧跟一句说明：「第三幕 风雪夜」「ACT II. The castle.」
 *  边界类里的 `\u3000`（全角空格）是**显式标注作者的真实输入形状**，不是额外判据：
 *  JS 的 `\s` 本身就含 U+3000（2026-11-10 轮 4 实测：摘掉它，「第三幕 + 全角空格 + 风雪夜」仍判为幕标）。
 *  写成转义而不是裸字符，是因为 eslint `no-irregular-whitespace` 不许源码里出现裸全角空格。 */
const ACT_INLINE_ZH = /^\s*(第\s*[〇零一二两三四五六七八九十百千0-9]{1,6}\s*[幕折])(?=$|[\s\u3000:：.、,，-])/;
const SCENE_INLINE_ZH = /^\s*(第\s*[〇零一二两三四五六七八九十0-9]{1,6}\s*[场景])(?=$|[\s\u3000:：.、,，-])/;

/** 整块被括号包起来 = 舞台指示（中英文剧本的通行写法） */
const DIRECTION_WRAPPED = /^[（([【{][\s\S]*[)）\]】}]$/;
/** 中文对白：「角色名：台词」，名字 1-8 字且不含句读 */
const DIALOGUE_ZH = /^\s*([^\s：:，。！？、；,.!?;（）()【】""'']{1,8})[：:]\s*(\S[\s\S]*)$/;
/** 英文对白：HAMLET: To be... / GHOST: ...（惯例是全大写；也接受短的名字大小写混排） */
const DIALOGUE_EN = /^\s*([A-Z][A-Z\s.'’-]{0,24}|[A-Z][a-z]{1,14})(?:\s*\((?:to\s+)?[^)]*\))?\s*:\s*(\S[\s\S]*)$/;

/** 长台词阈值（经验值，只作提示）：中文按字、英文按词 */
export const MONOLOGUE_UNITS_ZH = 120;
export const MONOLOGUE_WORDS_EN = 80;
/** 叙述段阈值：超过它才叫"写成散文了"，没超过多半是布景 / 时间 / 地点行 */
export const NARRATIVE_UNITS_ZH = 30;
export const NARRATIVE_WORDS_EN = 20;

function classify(line: string, cjk: boolean): ScriptBlock {
  const text = line.trim();
  const units = countWrittenUnits(text);
  const words = countWords(text);
  const base = { text, units, words };

  if (ACT_ZH.test(text) || ACT_EN.test(text)) {
    const m = text.match(ACT_INLINE_ZH);
    return { index: 0, kind: 'act', label: m ? m[1] : text.slice(0, 12), speaker: '', ...base };
  }
  if (SCENE_ZH.test(text) || SCENE_EN.test(text)) {
    const m = text.match(SCENE_INLINE_ZH);
    return { index: 0, kind: 'scene', label: m ? m[1] : text.slice(0, 12), speaker: '', ...base };
  }
  // 带说明的幕场行（「第三幕 风雪夜」）走内联式；纯标点装饰不算
  if (ACT_INLINE_ZH.test(text) && units <= 24) {
    return { index: 0, kind: 'act', label: text.match(ACT_INLINE_ZH)![1], speaker: '', ...base };
  }
  if (SCENE_INLINE_ZH.test(text) && units <= 24) {
    return { index: 0, kind: 'scene', label: text.match(SCENE_INLINE_ZH)![1], speaker: '', ...base };
  }
  if (DIRECTION_WRAPPED.test(text)) return { index: 0, kind: 'direction', label: '', speaker: '', ...base };

  const zh = text.match(DIALOGUE_ZH);
  if (zh) return { index: 0, kind: 'dialogue', label: '', speaker: zh[1].trim(), ...base };
  if (!cjk) {
    const en = text.match(DIALOGUE_EN);
    if (en) return { index: 0, kind: 'dialogue', label: '', speaker: en[1].trim(), ...base };
  }
  return { index: 0, kind: 'prose', label: '', speaker: '', ...base };
}

/**
 * 台本正文 → 结构读数。
 * @param content 正文 HTML（或纯文本草稿，内部按同一套块解析兜底）
 * @param characterNames 角色表（可选）：传了才能核「说了话却没建档」的名字
 */
export function analyzeScriptStructure(content: string, characterNames: string[] = []): ScriptStructure {
  const raw = htmlContentBlocks(content);
  const flat = raw.flat().join('\n');
  const cjk = hasCjkText(flat);

  const blocks: ScriptBlock[] = [];
  for (const block of raw) {
    for (const line of block) {
      const b = classify(line, cjk);
      blocks.push({ ...b, index: blocks.length });
    }
  }

  const acts = blocks.filter((b) => b.kind === 'act').length;
  const scenes = blocks.filter((b) => b.kind === 'scene').length;

  // 分场：有场标题按场切；没有场标题但有幕标题 → 按幕切；两者都没有 → 整本算一场
  const splitKind = scenes > 0 ? 'scene' : acts > 0 ? 'act' : '';
  const sceneDialogueLines: number[] = [];
  let current = -1;
  for (const b of blocks) {
    if (splitKind === '' ) {
      if (current === -1) { sceneDialogueLines.push(0); current = 0; }
      if (b.kind === 'dialogue') sceneDialogueLines[0] += 1;
      continue;
    }
    if (b.kind === splitKind) { sceneDialogueLines.push(0); current = sceneDialogueLines.length - 1; continue; }
    if (b.kind === 'dialogue' && current >= 0) sceneDialogueLines[current] += 1;
  }
  const silentScenes = sceneDialogueLines.map((n, i) => (n === 0 ? i + 1 : 0)).filter((n) => n > 0);

  const byName = new Map<string, ScriptSpeakerStat>();
  let dialogueLines = 0;
  let totalUnits = 0;
  const monologues: ScriptStructure['monologues'] = [];
  for (const b of blocks) {
    if (b.kind !== 'dialogue') continue;
    dialogueLines += 1;
    totalUnits += b.units;
    const cur = byName.get(b.speaker) ?? { name: b.speaker, lines: 0, units: 0, share: 0 };
    cur.lines += 1;
    cur.units += b.units;
    byName.set(b.speaker, cur);
    if (cjk ? b.units >= MONOLOGUE_UNITS_ZH : b.words >= MONOLOGUE_WORDS_EN) {
      monologues.push({ speaker: b.speaker, index: b.index, units: b.units, words: b.words });
    }
  }
  const speakers = Array.from(byName.values())
    .map((s) => ({ ...s, share: totalUnits > 0 ? s.units / totalUnits : 0 }))
    .sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name));

  const known = new Set(characterNames.map((n) => n.trim()).filter(Boolean));
  const unknownSpeakers = known.size > 0 ? speakers.map((s) => s.name).filter((n) => !known.has(n)) : [];

  const prose = blocks.filter((b) => b.kind === 'prose');
  const narrative = prose.filter((b) => (cjk ? b.units >= NARRATIVE_UNITS_ZH : b.words >= NARRATIVE_WORDS_EN));

  return {
    blocks,
    acts,
    scenes,
    sceneDialogueLines,
    silentScenes,
    speakers,
    dialogueLines,
    directionLines: blocks.filter((b) => b.kind === 'direction').length,
    proseBlocks: prose.length,
    narrativeBlocks: narrative.length,
    monologues,
    hasHeadings: acts > 0 || scenes > 0,
    unknownSpeakers,
    cjk,
  };
}

export type ScriptStructureTone = 'empty' | 'no-heading' | 'prose-risk' | 'warn' | 'ok';

/**
 * 徽标色调。**散文风险与未标注结构是硬事实**（写没写幕场标题一眼可验）；
 * 长台词与空场只是提示，落 `warn`，不与 `prose-risk` 抢同一种红。
 */
export function scriptStructureTone(s: ScriptStructure): ScriptStructureTone {
  if (s.blocks.length === 0) return 'empty';
  if (!s.hasHeadings) return 'no-heading';
  if (s.proseBlocks > 0 && s.dialogueLines === 0) return 'prose-risk';
  if (s.silentScenes.length > 0 || s.narrativeBlocks > 0 || s.unknownSpeakers.length > 0) return 'warn';
  return 'ok';
}

/** 一句话读数（只出 i18n key + 参数，不调 t()） */
export function scriptStructureBadge(s: ScriptStructure): { key: string; params: Record<string, number> } {
  if (s.blocks.length === 0) return { key: 'writing.scriptStructUI.empty', params: {} };
  if (!s.hasHeadings) return { key: 'writing.scriptStructUI.noHeadings', params: { dialogue: s.dialogueLines } };
  if (s.proseBlocks > 0 && s.dialogueLines === 0) {
    return { key: 'writing.scriptStructUI.proseRisk', params: { prose: s.proseBlocks } };
  }
  return {
    key: 'writing.scriptStructUI.summary',
    params: { acts: s.acts, scenes: s.scenes, speakers: s.speakers.length },
  };
}

/** 给 AI 语料用的结构读数（中英各一条；数字来自实测，不做任何评价性措辞） */
export function scriptStructureCorpusLines(s: ScriptStructure): { zh: string[]; en: string[] } {
  if (s.blocks.length === 0) return { zh: [], en: [] };
  const sceneList = s.silentScenes.slice(0, 8).join('、');
  const zh = [
    `〔结构〕幕 ${s.acts} · 场 ${s.scenes} · 对白 ${s.dialogueLines} 行 · 舞台指示 ${s.directionLines} 段 · 说话人 ${s.speakers.length}`,
    s.speakers.length > 0
      ? `〔台词量分布〕${s.speakers.slice(0, 8).map((x) => `${x.name} ${x.lines}行`).join(' / ')}`
      : `〔台词量分布〕无人说话`,
  ];
  const en = [
    `[Structure] acts ${s.acts} · scenes ${s.scenes} · ${s.dialogueLines} dialogue lines · ${s.directionLines} stage directions · ${s.speakers.length} speakers`,
    s.speakers.length > 0
      ? `[Lines per speaker] ${s.speakers.slice(0, 8).map((x) => `${x.name} ${x.lines}`).join(' / ')}`
      : `[Lines per speaker] nobody speaks`,
  ];
  if (s.silentScenes.length > 0) {
    zh.push(`〔无对白的场〕共 ${s.silentScenes.length} 处：第 ${sceneList} 场`);
    en.push(`[Scenes with no dialogue] ${s.silentScenes.length}: ${s.silentScenes.slice(0, 8).join(', ')}`);
  }
  if (s.narrativeBlocks > 0) {
    zh.push(`〔叙述段〕${s.narrativeBlocks} 段既不像对白也不像舞台指示（台本里出现整段叙述，通常是格式没写对）`);
    en.push(`[Narrative blocks] ${s.narrativeBlocks} read neither as dialogue nor stage direction`);
  }
  if (s.unknownSpeakers.length > 0) {
    zh.push(`〔未建档说话人〕${s.unknownSpeakers.slice(0, 8).join('、')}`);
    en.push(`[Speakers without a card] ${s.unknownSpeakers.slice(0, 8).join(', ')}`);
  }
  return { zh, en };
}
