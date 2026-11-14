// 诗歌的**形式**（form）—— 体裁之内的再一维。
//
// 立项原因（2026-11-09 李先生两条接连指出）：
// ①「诗歌还分很多种：四言、五言，中国的更多 —— 你这个相当于还没实现」；
// ②「除了中文还要做英文的，英文的诗歌肯定不一样，界面切到英文时要切成英文的一套」。
//
// 第 ② 条不是翻译工作，是**度量体系不同**：
//   · 中文近体诗量的是**每句字数（言）**；英文量的是**音节 / 音步**（五步抑扬格 = 10 音节）。
//     把 `charsPerLine` 套到英文诗上，等于按"每句几个字母"去判莎士比亚 —— 必错。
//   · 英文形式的骨架是**节结构（stanza form）**：莎氏十四行 4+4+4+2，彼特拉克 8+6，
//     villanelle 3+3+3+3+3+4（19 行），sestina 6×6+3（39 行）。中文侧只有"总句数"这一维。
//
// 三条诚实边界（写死在代码里，别在界面上冒充能力）：
//   1) **音节数只能估算**（-e 不发音、-le 成音节、连元音分合读），所以它只出 `advisory`，
//      绝不与"句数 / 节结构 / 每句字数"这种可判定的硬结论混成同一个红叉；
//   2) **语种不匹配就不下判定**：形式标的是五言而正文是英文 → 返回 `measureSkipped`，
//      不产出"每句 12 字不符"这种废话；
//   3) 韵式（rhyme scheme）不校；平仄、词牌、曲牌照旧不内置。
//
// 铁律同 writingSchema：只存 i18n key，模块级绝不调 t()。

import { parseChapterExtra } from '../services/writing';
import { htmlContentBlocks, countWrittenUnits, hasCjkText } from './contentBlocks';
import type { Lang } from '../i18n';

export type PoetryTradition = 'cn-classic' | 'cn-modern' | 'west' | 'japan';

/** 这套形式天然属于哪种诗语言：决定界面语言下它排前面，以及语种不匹配时跳过度量判定 */
export type PoetryFormLangFit = 'zh' | 'en' | 'any';

export interface PoetryFormDef {
  id: string;
  labelKey: string;
  tradition: PoetryTradition;
  fit: PoetryFormLangFit;
  /** 中文"言"：每句几个**字**（标点不计） */
  charsPerLine?: number;
  /** 每句音节数（估算，仅提示） */
  syllablesPerLine?: number;
  /** 逐行音节谱（如俳句 5-7-5；估算，仅提示） */
  syllablePattern?: number[];
  /** 全篇句数区间 */
  lineCount?: { min: number; max: number };
  /** 精确节结构：每节几行，顺序敏感（莎氏十四行 = [4,4,4,2]） */
  stanzas?: number[];
  /** 重复节长：每节固定几行、节数不限（民谣节 4、英雄双句 2） */
  stanzaSize?: number;
}

export const POETRY_TRADITION_KEYS: Record<PoetryTradition, string> = {
  'cn-classic': 'writing.poetryTradition.cnClassic',
  'cn-modern': 'writing.poetryTradition.cnModern',
  west: 'writing.poetryTradition.west',
  japan: 'writing.poetryTradition.japan',
};

export const POETRY_FORMS: PoetryFormDef[] = [
  // ── 中国古典（量度：言 = 每句字数）
  { id: 'si-yan', labelKey: 'writing.poetryForm.siYan', tradition: 'cn-classic', fit: 'zh', charsPerLine: 4 },
  { id: 'wu-jueju', labelKey: 'writing.poetryForm.wuJueju', tradition: 'cn-classic', fit: 'zh', charsPerLine: 5, lineCount: { min: 4, max: 4 } },
  { id: 'wu-lvshi', labelKey: 'writing.poetryForm.wuLvshi', tradition: 'cn-classic', fit: 'zh', charsPerLine: 5, lineCount: { min: 8, max: 8 } },
  { id: 'qi-jueju', labelKey: 'writing.poetryForm.qiJueju', tradition: 'cn-classic', fit: 'zh', charsPerLine: 7, lineCount: { min: 4, max: 4 } },
  { id: 'qi-lvshi', labelKey: 'writing.poetryForm.qiLvshi', tradition: 'cn-classic', fit: 'zh', charsPerLine: 7, lineCount: { min: 8, max: 8 } },
  { id: 'gu-feng', labelKey: 'writing.poetryForm.guFeng', tradition: 'cn-classic', fit: 'zh' },
  // ── 中国现代 / 通用无格律
  { id: 'free-verse', labelKey: 'writing.poetryForm.freeVerse', tradition: 'cn-modern', fit: 'any' },
  { id: 'prose-poem', labelKey: 'writing.poetryForm.prosePoem', tradition: 'cn-modern', fit: 'any' },
  { id: 'acrostic', labelKey: 'writing.poetryForm.acrostic', tradition: 'west', fit: 'any' },
  // ── 西方 / 日本（量度：音节与节结构）
  { id: 'sonnet', labelKey: 'writing.poetryForm.sonnet', tradition: 'west', fit: 'en', lineCount: { min: 14, max: 14 } },
  { id: 'sonnet-shakespearean', labelKey: 'writing.poetryForm.sonnetShakespearean', tradition: 'west', fit: 'en', stanzas: [4, 4, 4, 2], syllablesPerLine: 10 },
  { id: 'sonnet-petrarchan', labelKey: 'writing.poetryForm.sonnetPetrarchan', tradition: 'west', fit: 'en', stanzas: [8, 6], syllablesPerLine: 10 },
  { id: 'villanelle', labelKey: 'writing.poetryForm.villanelle', tradition: 'west', fit: 'en', stanzas: [3, 3, 3, 3, 3, 4] },
  { id: 'sestina', labelKey: 'writing.poetryForm.sestina', tradition: 'west', fit: 'en', stanzas: [6, 6, 6, 6, 6, 6, 3] },
  { id: 'limerick', labelKey: 'writing.poetryForm.limerick', tradition: 'west', fit: 'en', lineCount: { min: 5, max: 5 } },
  { id: 'ballad-stanza', labelKey: 'writing.poetryForm.balladStanza', tradition: 'west', fit: 'en', stanzaSize: 4 },
  { id: 'heroic-couplet', labelKey: 'writing.poetryForm.heroicCouplet', tradition: 'west', fit: 'en', stanzaSize: 2, syllablesPerLine: 10 },
  { id: 'blank-verse', labelKey: 'writing.poetryForm.blankVerse', tradition: 'west', fit: 'en', syllablesPerLine: 10 },
  { id: 'ghazal', labelKey: 'writing.poetryForm.ghazal', tradition: 'west', fit: 'en', stanzaSize: 2 },
  { id: 'haiku', labelKey: 'writing.poetryForm.haiku', tradition: 'japan', fit: 'en', lineCount: { min: 3, max: 3 }, syllablePattern: [5, 7, 5] },
];

export function poetryFormDef(formId: string): PoetryFormDef | undefined {
  return POETRY_FORMS.find((f) => f.id === formId);
}

/**
 * 界面语言 → 形式清单的**排序与分组**（李先生：「国际环境切到英文的条件下要切成英文的」）。
 *
 * 只做排序，**不做隐藏**：中文界面下英文传统排后面（不是没有），英文界面反之。
 * 理由是这条仓里的老规矩 —— 折叠的是展示，不是事实；作者用英文写五言、用中文写十四行
 * 都是真实存在的写法，把选项抹掉等于把他的数据变成不可选。
 */
const TRADITION_ORDER_BY_LANG: Record<Lang, PoetryTradition[]> = {
  'zh-CN': ['cn-classic', 'cn-modern', 'japan', 'west'],
  'en-US': ['west', 'japan', 'cn-modern', 'cn-classic'],
};

export function poetryGroupsForLang(lang: Lang): { tradition: PoetryTradition; forms: PoetryFormDef[] }[] {
  const order = TRADITION_ORDER_BY_LANG[lang] ?? TRADITION_ORDER_BY_LANG['zh-CN'];
  return order
    .map((tradition) => ({ tradition, forms: POETRY_FORMS.filter((f) => f.tradition === tradition) }))
    .filter((g) => g.forms.length > 0);
}

/** extra 里的键名（存 `writing_chapters.extra`，该字段本来就有 → 零迁移、不动表结构） */
export const POEM_FORM_EXTRA_KEY = 'poemForm';

/** 读某章标过的形式；没标 / 脏数据 = 空串 */
export function readPoemForm(extra: string): string {
  const v = parseChapterExtra(extra)[POEM_FORM_EXTRA_KEY];
  return typeof v === 'string' ? v : '';
}

/** 写形式（空串 = 清除标注）；保留 extra 里其余键（章头图 / deletedAt 等） */
export function withPoemForm(extra: string, formId: string): string {
  const obj: Record<string, unknown> = { ...parseChapterExtra(extra) };
  if (formId) obj[POEM_FORM_EXTRA_KEY] = formId;
  else delete obj[POEM_FORM_EXTRA_KEY];
  return JSON.stringify(obj);
}

/** 一个"字"的口径：只数文字与数字，**标点不算**（五言的"五"是五个字，不是五个字符）。
 *  ⑯-1 起实现搬到 `contentBlocks`（剧本的对白长度要用同一把尺子），这里保留原名字对外。 */
export function countPoemChars(line: string): number {
  return countWrittenUnits(line);
}

/** 含 CJK 字符（判语种用；只看有没有汉字，不看比例） */
export function hasCjk(text: string): boolean {
  return hasCjkText(text);
}

/**
 * 英文音节数**估算**（规则版，非词典版）：元音群计数 + 不发音 -e 减免 + -le/-es 补偿。
 * 只用于提示；界面上不得与硬判定同色同权重。
 */
export function estimateSyllables(line: string): number {
  const words = line
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let n = 0;
  for (const w of words) {
    let t = w.replace(/[^a-z]/g, '');
    if (!t) continue;
    // -le 成音节（bottle = bot-tle）：**保留那个 e**，让它自成一群元音被数到；
    // 原来我在这里把 e 删掉，等于亲手把这个音节抹了（bottle 判成 1 音节，测试红给我看）
    t = t.replace(/(?:[^la]|^)es?$/, (m) => (/(?:[^aeiou])(?:es|s)$/.test(t) ? m : m.replace(/e$/, '')));
    // 不发音 -e：made = 1。**`-le` 必须豁免** —— 那个 e 正是要数进去的成音节 e（bottle = 2）。
    if (/[^aeiou]e$/.test(t) && !/[^aeiou]le$/.test(t) && t.length > 3) t = t.replace(/e$/, '');
    const groups = t.match(/[aeiouy]+/g);
    n += Math.max(1, groups ? groups.length : 1);
  }
  return n;
}

/** 正文 HTML → 诗的行（**节与节之间的空行不算句**，只用于分节） */
export function poemLines(content: string): string[] {
  return poemStanzas(content).flat();
}

/**
 * 正文 HTML → 节。实现已搬到 `contentBlocks.htmlContentBlocks`（⑯-1：剧本结构与对白校验
 * 必须按同一套块解析，不能自己再写一份），这里保留 `poemStanzas` 这个对外名字。
 * 为什么不能吃 stripHtmlText 的输出、为什么必须直接解析 HTML —— 见那边注释。
 */
export function poemStanzas(content: string): string[][] {
  return htmlContentBlocks(content);
}

export interface PoemFormCheck {
  formId: string;
  /** 没标形式或形式不认识：不下任何结论（绝不"默认合格"糊弄作者） */
  applicable: boolean;
  /** 该形式本身无硬约束（自由诗 / 散文诗 / 藏头…） */
  unconstrained: boolean;
  /** 语种与形式不匹配（五言标在英文诗上…）：硬判定整体跳过，不产出废话结论 */
  measureSkipped: '' | 'zh-form-on-non-cjk' | 'en-form-on-cjk';
  lines: { index: number; chars: number; syllables: number; ok: boolean }[];
  lineCountOk: boolean;
  /** 节结构是否合式（无节结构要求时恒 true） */
  stanzaOk: boolean;
  /** 实际节长序列（界面上直接可读："4+4+4+2"） */
  stanzaShape: number[];
  /** 出格的句数（每句字数不符） */
  badCharLines: number;
  /** 硬结论（只由 句数 / 节结构 / 每句字数 决定；估算一律不参与） */
  ok: boolean;
  /** 音节提示（估算）：null = 该形式无音节要求 */
  meterOk: boolean | null;
}

const NOT_APPLICABLE: PoemFormCheck = {
  formId: '',
  applicable: false,
  unconstrained: false,
  measureSkipped: '',
  lines: [],
  lineCountOk: true,
  stanzaOk: true,
  stanzaShape: [],
  badCharLines: 0,
  ok: true,
  meterOk: null,
};

/** 硬判：句数 + 节结构 + 每句字数；估算：音节。两条通道分开，永不合并成一个红叉。 */
export function checkPoemForm(content: string, formId: string): PoemFormCheck {
  const def = poetryFormDef(formId);
  if (!def) return NOT_APPLICABLE;

  const rows = poemLines(content);
  const shape = poemStanzas(content).map((s) => s.length);
  const text = rows.join(' ');
  const cjk = hasCjk(text);

  const measureSkipped: PoemFormCheck['measureSkipped'] =
    def.fit === 'zh' && text.length > 0 && !cjk
      ? 'zh-form-on-non-cjk'
      : def.fit === 'en' && text.length > 0 && cjk
        ? 'en-form-on-cjk'
        : '';

  const hasHard =
    (def.charsPerLine !== undefined && measureSkipped === '') ||
    def.lineCount !== undefined ||
    def.stanzas !== undefined ||
    def.stanzaSize !== undefined;

  const charCheckOn = def.charsPerLine !== undefined && measureSkipped === '';
  const lines = rows.map((l, i) => {
    const chars = countPoemChars(l);
    return { index: i + 1, chars, syllables: estimateSyllables(l), ok: charCheckOn ? chars === def.charsPerLine : true };
  });

  const lineCountOk = !def.lineCount || (rows.length >= def.lineCount.min && rows.length <= def.lineCount.max);

  let stanzaOk = true;
  if (def.stanzas) stanzaOk = shape.length === def.stanzas.length && shape.every((n, i) => n === def.stanzas![i]);
  else if (def.stanzaSize) stanzaOk = shape.length > 0 && shape.every((n) => n % def.stanzaSize! === 0);

  const badCharLines = lines.filter((l) => !l.ok).length;

  let meterOk: boolean | null = null;
  if (measureSkipped === '' && (def.syllablesPerLine !== undefined || def.syllablePattern)) {
    meterOk = lines.every((l, i) =>
      def.syllablePattern ? Math.abs(l.syllables - (def.syllablePattern[i] ?? -1)) <= 1 : Math.abs(l.syllables - (def.syllablesPerLine ?? 0)) <= 1,
    );
  }

  return {
    formId,
    applicable: true,
    unconstrained: !hasHard,
    measureSkipped,
    lines,
    lineCountOk,
    stanzaOk,
    stanzaShape: shape,
    badCharLines,
    ok: hasHard ? lineCountOk && stanzaOk && badCharLines === 0 : true,
    meterOk,
  };
}

// ───────────────────────── 只读判定视图（组件只渲染，不算口径） ─────────────────────────
//
// 单独立成一层的原因：树行 / 篇目栏 / 检查器三个地方都要显示"这首合不合式"，
// 而**判定的前提各不相同**（树列表可能不带正文）。把"什么时候不许下结论"写进一个纯函数，
// 三个面才不会各写一套 —— 尤其不能出现"正文没加载 → 五言绝句被判零句不合格"这种假红。

export type PoemFormTone = 'none' | 'ok' | 'bad' | 'skip';

export interface PoemFormView {
  formId: string;
  labelKey: string;
  traditionKey: string;
  tone: PoemFormTone;
  /** 正文没加载 / 为空 → 只标形式名，绝不下判定 */
  notMeasured: boolean;
  /** 状态文案 key（tone='none' 时是「未标形式」） */
  messageKey: string;
  messageParams: Record<string, string | number>;
  /** 实际节结构，如 "4+4+4+2"（无节结构要求则空串） */
  stanzaShape: string;
  /** 音节估算读数（advisory，与 tone 完全无关，永不参与红绿） */
  meterHint: string | null;
}

/**
 * extra 里没标形式 → null（调用方显示"未标形式"的空态控件，别自己造 tone）。
 */
export function poemFormView(content: string, extra: string): PoemFormView | null {
  const formId = readPoemForm(extra);
  const def = formId ? poetryFormDef(formId) : undefined;
  if (!def) return null;

  const base = {
    formId: def.id,
    labelKey: def.labelKey,
    traditionKey: POETRY_TRADITION_KEYS[def.tradition],
    stanzaShape: '',
    meterHint: null as string | null,
  };

  const trimmed = (content || '').trim();
  // 判定前提只有一个：取得到行。取不到（正文没加载 / 空章 / 只有空段落）就只标形式名。
  if (trimmed.length === 0 || poemLines(trimmed).length === 0) {
    return { ...base, tone: 'none', notMeasured: true, messageKey: 'writing.poemFormUI.formNone', messageParams: {} };
  }

  const c = checkPoemForm(content, def.id);
  const shape = c.stanzaShape.join('+');
  const meterHint = c.meterOk === null ? null : avgSyllables(c.lines);
  const common = { ...base, notMeasured: false, stanzaShape: shape, meterHint };

  if (c.measureSkipped) {
    return { ...common, tone: 'skip', messageKey: 'writing.poemFormUI.formLangSkip', messageParams: {} };
  }
  if (c.unconstrained) {
    return { ...common, tone: 'none', messageKey: 'writing.poemFormUI.formNone', messageParams: {} };
  }
  if (c.lineCountOk && c.stanzaOk && c.badCharLines === 0) {
    return { ...common, tone: 'ok', messageKey: 'writing.poemFormUI.formOk', messageParams: {} };
  }
  const expect = def.stanzas ? def.stanzas.join('+') : def.stanzaSize ? `${def.stanzaSize}×n` : '';
  if (!c.lineCountOk || !c.stanzaOk) {
    return {
      ...common,
      tone: 'bad',
      messageKey: 'writing.poemFormUI.formStanzaBad',
      messageParams: { actual: shape || c.lines.length, expect: expect || c.lines.length },
    };
  }
  return {
    ...common,
    tone: 'bad',
    messageKey: 'writing.poemFormUI.formBad',
    messageParams: { n: c.badCharLines },
  };
}

/** 音节平均读数（advisory）；只在"该形式有音节要求"时被调用。本模块不调 t()，只回数字串 */
function avgSyllables(lines: { syllables: number }[]): string {
  if (lines.length === 0) return '0';
  return String(Math.round(lines.reduce((n, l) => n + l.syllables, 0) / lines.length));
}
