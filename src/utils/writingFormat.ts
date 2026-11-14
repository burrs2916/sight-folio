// 正文格式规范与排版体检（F1，2026-11-06）
//
// **为什么必须有这个文件**：作者写正文时，缩进/空格/标点全凭手感，编辑器既不提示也不报错，
// 于是这些问题一路带进成书产物。实测真库里第一章段首就是 `&nbsp; &nbsp; &nbsp; &nbsp;`
// —— 手工硬空格冒充首行缩进；而编辑器工具栏的缩进存的是 `padding-left`（整段左缩进），
// 导出侧要的是 `text-indent`（首行缩进）—— 三套口径互不相通，产物自然不合格。
//
// 本文件是**结构层**规则的唯一真源（文本层规则见 proofreadEngine，两边不重叠）：写作侧（徽标 + 一键修）与导出侧（渲染前规范化）都从这里取。
// 中文与西文规则**不同**（`lang` 参数）：中文靠首行缩进分段、段间不空行；
// 西文靠段距分段、首行不缩。这是"中英文都不同"的正面回答，不是靠一个 indent 布尔乱拧。
//
// 导出侧（Rust）会镜像一份规则，并用跨语言源码锁钉住不漂移
// （做法同 `typographyExportLock.test.ts`）。改这里必须同步改 Rust 与那把锁。

export type FormatLang = 'zh' | 'en';

export interface FormatSpec {
  lang: FormatLang;
  /** 首行缩进策略：中文默认两字，西文默认不缩 */
  firstLineIndent: 'none' | 'twoChars' | 'custom';
  /** firstLineIndent = custom 时的字数 */
  indentChars: number;
  /** 段后距（em）。中文档通常 0，西文档通常 0.8 */
  paragraphGapEm: number;
  /** 中西文之间自动补空格（盘古之白） */
  pangu: boolean;
}

export const DEFAULT_SPEC_ZH: FormatSpec = {
  lang: 'zh',
  firstLineIndent: 'twoChars',
  indentChars: 2,
  paragraphGapEm: 0,
  pangu: true,
};

export const DEFAULT_SPEC_EN: FormatSpec = {
  lang: 'en',
  firstLineIndent: 'none',
  indentChars: 0,
  paragraphGapEm: 0.8,
  pangu: false,
};

// 只收**结构层**（HTML 里才看得见、引擎在纯文本口径下看不见）的 8 条。
//
// 故意不含标点/省略号/破折号/重复标点/长段 —— 那些已由
// `editor/proofread/proofreadEngine.ts`（带词典、带 fix、可定位）与
// `utils/writingProofread.chapterTextIssues`（RepeatPunct / LongParagraph …）覆盖。
// 同一问题在两套判据里各报一次，是这套系统最容易自我削弱的方式（引擎注释也立了同一条规矩）。
export type RuleId =
  | 'leadingSpace'
  | 'paddingIndent'
  | 'emptyPara'
  | 'multiSpace'
  | 'trailingSpace'
  | 'brAsBreak'
  | 'missingPangu'
  | 'headingInBody';

export interface RuleMeta {
  id: RuleId;
  /** 给用户看的一句话（zh 环境用；键名走 i18n 时另说） */
  label: string;
  severity: 'error' | 'warn' | 'info';
  /** 能否一键修（false = 只报不改，语义相关的不许自动动） */
  fixable: boolean;
}

export const FORMAT_RULES: Record<RuleId, RuleMeta> = {
  leadingSpace: { id: 'leadingSpace', label: '段首用空格/硬空格当缩进', severity: 'error', fixable: true },
  paddingIndent: { id: 'paddingIndent', label: '用整段左缩进冒充实首行缩进', severity: 'error', fixable: true },
  emptyPara: { id: 'emptyPara', label: '空段落（幽灵段）', severity: 'warn', fixable: true },
  multiSpace: { id: 'multiSpace', label: '连续多个空格', severity: 'warn', fixable: true },
  trailingSpace: { id: 'trailingSpace', label: '段末多余空白', severity: 'info', fixable: true },
  brAsBreak: { id: 'brAsBreak', label: '用换行冒充分段', severity: 'error', fixable: true },
  missingPangu: { id: 'missingPangu', label: '中西文之间缺空格', severity: 'info', fixable: true },
  headingInBody: { id: 'headingInBody', label: '正文里手写了标题', severity: 'warn', fixable: false },
};

export interface FormatIssue {
  rule: RuleId;
  count: number;
  /** 供定位用的最短证据（截断，绝不含整段正文） */
  excerpt: string;
}

const CJK = '\u4e00-\u9fff\u3400-\u4dbf';



/** 剥掉标签拿纯文本（只用于统计与判断，不回写） */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** 逐个 `<p>` 片段扫（含属性），体检与规范化共用同一套切分，避免两边判据不一致 */
function paragraphs(html: string): { open: string; inner: string }[] {
  const out: { open: string; inner: string }[] = [];
  const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push({ open: m[1] ?? '', inner: m[2] ?? '' });
  }
  return out;
}

/**
 * 正文格式体检：返回问题清单（同一规则聚合成一条，带次数与证据）。
 * 不抛错、不改内容 —— 报错由调用方（编辑器徽标 / 导出回执）决定怎么显示。
 */
export function lintFormat(html: string, spec: FormatSpec = DEFAULT_SPEC_ZH): FormatIssue[] {
  const found = new Map<RuleId, { count: number; excerpt: string }>();
  const hit = (rule: RuleId, excerpt: string, count = 1) => {
    const prev = found.get(rule);
    found.set(rule, {
      count: (prev?.count ?? 0) + count,
      // 留第一条当证据就够，UI 靠它跳转定位；计数才是给用户看规模用的
      excerpt: prev?.excerpt ?? excerpt.slice(0, 40),
    });
  };

  const paras = paragraphs(html);
  for (const { open, inner } of paras) {
    const plain = textOf(inner);
    // 段首硬空格 / 全角空格 / 普通空格（真库里最常见的写法）
    if (/^(?:&nbsp;|\u00a0|\u3000|\s)+\S/.test(inner.replace(/^<[^>]+>/, ''))) hit('leadingSpace', inner);
    if (/padding-left\s*:/i.test(open) || /data-text-indent/i.test(open)) hit('paddingIndent', open);
    if (plain.trim() === '') hit('emptyPara', inner);
    const multi = plain.trim().match(/(?:&nbsp;|\u00a0|\s){2,}/g);
    if (multi) hit('multiSpace', plain, multi.length);
    if (/(?:&nbsp;|\u00a0|\s)+$/.test(inner)) hit('trailingSpace', inner);
    if (/(?:<br\s*\/?>\s*){2,}/i.test(inner) || /^(?:<br\s*\/?>\s*)+/i.test(inner)) hit('brAsBreak', inner);
    if (/<h[1-6]\b/i.test(inner)) hit('headingInBody', inner);
    if (spec.pangu && new RegExp(`[${CJK}][A-Za-z0-9]|[A-Za-z0-9][${CJK}]`).test(plain)) {
      hit('missingPangu', plain);
    }
  }

  return [...found.entries()].map(([rule, v]) => ({ rule, count: v.count, excerpt: v.excerpt }));
}

/**
 * 一键规范化：**只改明确无歧义的排版噪声，绝不改语义**。
 * 不自动分段、不删正文、不动措辞；改了什么由调用方写进回执（不许悄悄改掉）。
 */
export function normalizeFormat(html: string, spec: FormatSpec = DEFAULT_SPEC_ZH): string {
  let out = html;

  // 1) 段首手工缩进（硬空格/全角空格/普通空格）一律摘掉 —— 缩进交给 text-indent 一处管
  out = out.replace(/(<p\b[^>]*>)(?:&nbsp;|\u00a0|\u3000|[ \t])+/g, '$1');

  // 2) 段末多余空白
  out = out.replace(/(?:&nbsp;|\u00a0|[ \t])+(<\/p>)/g, '$1');

  // 3) 空段落（只含空白/空 img 之外什么都没有）
  out = out.replace(/<p\b[^>]*>(?:&nbsp;|\u00a0|\s)*<\/p>/g, '');

  // 4) 行内连续空白折叠为一个（`<pre>` 不参与，将来若支持代码块要排除）
  out = out.replace(/(?:&nbsp;[ \t]?|[ \t]{2,})(?=[\u4e00-\u9fff])/g, '');

  // 5) 连续 <br> 冒充分段 → 就地折成段落边界（保守：只处理连续两个及以上）
  out = out.replace(/(?:\s*<br\s*\/?>\s*){2,}/gi, '</p><p>');

  // 6) 中西文之间补薄空格（盘古之白）。这是**空白**问题，归本层；
  //    标点/省略号/破折号交还给 `applyAutoFixesHtml`（引擎带词典、可定位、有 fix），
  //    两边各改一遍会互相打脸，回执也说不清是谁动的。
  if (spec.pangu) {
    const cjk = '[\u4e00-\u9fff\u3400-\u4dbf]';
    out = out.replace(
      new RegExp(`(${cjk})([A-Za-z0-9])|([A-Za-z0-9])(${cjk})`, 'g'),
      (_m, a, b, c, d) => (a && b ? `${a}\u2009${b}` : `${c}\u2009${d}`),
    );
  }

  return out;
}

/** 供 UI 汇总用：按规则严重度排序的问题统计 */
export function summarize(issues: FormatIssue[]) {
  return issues
    .map((i) => ({ ...i, meta: FORMAT_RULES[i.rule] }))
    .sort((a, b) => {
      const order = { error: 0, warn: 1, info: 2 } as const;
      return order[a.meta.severity] - order[b.meta.severity];
    });
}

/**
 * 按内容自动判语种（用于"整本校验"——一本书里可能夹英文段落、引文、术语）。
 * 判据保守：CJK 占比过阈值才算中文；拿不准按 zh（它的规则更严，宁可多提示）。
 */
export function detectFormatLang(text: string): FormatLang {
  const plain = textOf(text);
  const cjkCount = (plain.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
  const letters = plain.trim().length;
  if (letters === 0) return 'zh';
  return cjkCount / letters >= 0.05 ? 'zh' : 'en';
}

/** 按内容取默认规范（语言自动 + 该语言的成书惯例） */
export function specForText(text: string): FormatSpec {
  return detectFormatLang(text) === 'en' ? DEFAULT_SPEC_EN : DEFAULT_SPEC_ZH;
}

/** 报告层用：规则 → 现有校对报告的 messageKey（结构类统一 Struct 前缀，便于派生"可修"） */
export const STRUCT_MESSAGE_KEYS: Record<RuleId, string> = {
  leadingSpace: 'StructLeadingIndent',
  paddingIndent: 'StructPaddingIndent',
  emptyPara: 'StructEmptyPara',
  multiSpace: 'StructMultiSpace',
  trailingSpace: 'StructTrailingSpace',
  brAsBreak: 'StructBrBreak',
  missingPangu: 'StructPanguSpace',
  headingInBody: 'StructHeadingInBody',
};
