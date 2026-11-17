// sight-folio: AI 味检测引擎（写作方案 A2 · 统计层）
// 纯前端轻量检测四类"AI 味"：模板套话、节奏单调、长句堆叠、情绪直述。
// 输入：纯文本（与 runProofread 同源，editor.getText()）；输出：AiFlavorIssue[] 按位置排序。
// 设计口径对齐 proofreadEngine：start/end 为 UTF-16 码元偏移，可直接经 locate.ts 映射回编辑器选区。
export type AiFlavorKind = 'template' | 'rhythm' | 'punctuation' | 'vague';

export interface AiFlavorIssue {
  kind: AiFlavorKind;
  /** 在纯文本中的起始字符偏移（UTF-16 code units） */
  start: number;
  /** 结束偏移 */
  end: number;
  /** 匹配到的原文片段 */
  excerpt: string;
  /** 严重度：template/vague 为 warning，rhythm/punctuation 为 hint */
  severity?: 'hint' | 'warning';
  /** 改写方向建议 */
  suggestion?: string;
}

/** AI 模板套话词库：连接词、总结词、万能比喻开头。命中即判模板痕迹 */
const TEMPLATE_PHRASES: { re: RegExp; suggestion: string }[] = [
  {
    re: /首先，|其次，|最后，|总而言之，|综上所述，|值得注意的是|不难发现|众所周知|与此同时|换句话说|毋庸置疑|显而易见|不可否认|值得一提的是/g,
    suggestion: '去掉模板连接词，直接进入内容或改用具体过渡',
  },
  {
    re: /仿佛[^，。！？\n]{0,10}(一般|一样|似的)/g,
    suggestion: '需要具体动作或感官细节支撑比喻，避免万能"仿佛…一般"',
  },
  {
    re: /宛如[^，。！？\n]{0,10}(一般|一样)/g,
    suggestion: '换成有独特视角的具象比喻，避免"宛如…一样"空转',
  },
  {
    re: /如同一([幅|张|个|条|阵|道|股|抹])/g,
    suggestion: '比喻要有落点，指出"像什么+为什么像"，别只贴标签',
  },
  {
    re: /心中涌起|涌上一股|脸上露出一抹|嘴角勾起一抹|眼中闪过一丝|一丝不祥的预感|一股莫名的/g,
    suggestion: '情绪直述偏套话，改为动作、生理反应或环境映射来呈现',
  },
];

/** 抽象情绪/评价词库：短句直接陈述情绪时判"情绪直述"（Show, don't tell 的反面）；导出供 B3 顾问复用 */
export const VAGUE_WORDS = [
  '开心',
  '快乐',
  '高兴',
  '难过',
  '伤心',
  '悲伤',
  '痛苦',
  '愤怒',
  '生气',
  '幸福',
  '温暖',
  '美丽',
  '漂亮',
  '可爱',
  '感动',
  '激动',
  '害怕',
  '恐惧',
  '孤独',
  '寂寞',
  '失望',
  '绝望',
  '惊讶',
  '震惊',
  '兴奋',
  '紧张',
  '焦虑',
  '疲惫',
  '迷茫',
  '坚定',
  '善良',
  '温柔',
  '美好',
  '奇妙',
  '难受',
  '舒服',
  '温馨',
  '浪漫',
  '甜蜜',
  '苦涩',
  '压抑',
  '空虚',
  '心碎',
  '欣喜',
  '沮丧',
  '尴尬',
  '羞愧',
  '自豪',
  '委屈',
  '遗憾',
  '释然',
  '惶恐',
  '无助',
];

export const STRONG_TEMPLATE_WORDS = ['总而言之', '综上所述', '毋庸置疑', '显而易见'] as const;

/** 把文本按句切分，保留每句的原文偏移区间（导出供 B3 ShowTell 复用同一句界口径） */
export function splitSentences(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  // 句界：。！？；… 及换行；无标点残余（如引号尾）并入前一句
  const re = /[^。！？；\n…]+[。！？；\n…]*|[^。！？；\n…]+$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    out.push({ text: m[0], start, end });
  }
  return out;
}

/** 去标点与空白后的"正文长度"（近似字数） */
function bodyLen(s: string): number {
  return s.replace(/[，、：；。！？…\s“”"'‘’（）()【】——《》〈〉:;,.!?…]/g, '').length;
}

/** 模板套话：逐条正则扫描全文，命中即报 */
function detectTemplate(text: string): AiFlavorIssue[] {
  const issues: AiFlavorIssue[] = [];
  for (const { re, suggestion } of TEMPLATE_PHRASES) {
    const rx = new RegExp(re.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      const isStrong = STRONG_TEMPLATE_WORDS.some((w) => m![0].includes(w));
      issues.push({
        kind: 'template',
        start,
        end,
        excerpt: text.slice(Math.max(0, start - 4), Math.min(text.length, end + 4)),
        severity: isStrong ? 'warning' : 'hint',
        suggestion: isStrong ? `${suggestion}；该词是典型总结腔，全篇应尽量不用` : suggestion,
      });
    }
  }
  return issues;
}

/** 节奏单调：句长方差过低（连续 ≥4 句长度都在全局均值 ±20% 内，且全局变异系数低） */
function detectRhythm(text: string, sentences: { text: string; start: number; end: number }[]): AiFlavorIssue[] {
  const bodies = sentences.map((s) => ({ ...s, len: bodyLen(s.text) })).filter((s) => s.len >= 8);
  if (bodies.length < 6) return [];
  const lens = bodies.map((b) => b.len);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length;
  const std = Math.sqrt(variance);
  const cv = mean > 0 ? std / mean : 0;
  if (cv >= 0.5) return [];

  // 找连续 ≥4 句长度都在 [0.8*mean, 1.2*mean] 的窗口
  let run = 0;
  let runStart = -1;
  let runEnd = -1;
  for (let i = 0; i < bodies.length; i++) {
    const within = bodies[i].len >= mean * 0.8 && bodies[i].len <= mean * 1.2;
    if (within) {
      if (run === 0) runStart = i;
      run++;
      runEnd = i;
      if (run >= 4) break;
    } else {
      run = 0;
    }
  }
  if (run < 4 || runStart < 0) return [];

  const first = bodies[runStart];
  const last = bodies[runEnd];
  return [
    {
      kind: 'rhythm',
      start: first.start,
      end: last.end,
      excerpt: text.slice(first.start, last.end),
      severity: 'hint',
      suggestion: '连续多句长度接近，读起来节奏平；穿插短句点刹或长句铺陈',
    },
  ];
}

/** 长句堆叠：一句内逗号 ≥3 且正文 ≥60 字，或正文 ≥90 字的长句 */
function detectPunctuation(sentences: { text: string; start: number; end: number }[]): AiFlavorIssue[] {
  const issues: AiFlavorIssue[] = [];
  for (const s of sentences) {
    const commas = (s.text.match(/[，、；]/g) || []).length;
    const len = bodyLen(s.text);
    if (len >= 60 && commas >= 3) {
      issues.push({
        kind: 'punctuation',
        start: s.start,
        end: s.end,
        excerpt: s.text.slice(0, 44),
        severity: 'hint',
        suggestion: '一逗到底的长句，按语义切成 2-3 个短句，让读者有换气点',
      });
    } else if (len >= 90) {
      issues.push({
        kind: 'punctuation',
        start: s.start,
        end: s.end,
        excerpt: s.text.slice(0, 44),
        severity: 'hint',
        suggestion: '句子过长，尝试在逻辑转折处拆句',
      });
    }
  }
  return issues;
}

/** 情绪直述：短句（≤26 字）直接陈述抽象情绪/评价词，缺具体呈现 */
function detectVague(_text: string, sentences: { text: string; start: number; end: number }[]): AiFlavorIssue[] {
  const issues: AiFlavorIssue[] = [];
  for (const s of sentences) {
    const len = bodyLen(s.text);
    if (len > 26) continue;
    const hit = VAGUE_WORDS.find((w) => s.text.includes(w));
    if (!hit) continue;
    const idx = s.text.indexOf(hit);
    issues.push({
      kind: 'vague',
      start: s.start + idx,
      end: s.end,
      excerpt: s.text.trim().slice(0, 30),
      severity: 'warning',
      suggestion: `「${hit}」是抽象直述：用动作、感官细节或他者反应呈现，别直接贴情绪标签`,
    });
  }
  return issues;
}

function priority(i: AiFlavorIssue): number {
  if (i.kind === 'template' && i.severity === 'warning') return 3;
  if (i.kind === 'vague') return 2;
  if (i.kind === 'template') return 1;
  return 0;
}

/** 主入口：对单章正文执行四维 AI 味检测，返回按 start 升序、同 start 按优先级降序的问题列表 */
export function detectAiFlavor(text: string): AiFlavorIssue[] {
  const sentences = splitSentences(text);
  const all: AiFlavorIssue[] = [
    ...detectTemplate(text),
    ...detectRhythm(text, sentences),
    ...detectPunctuation(sentences),
    ...detectVague(text, sentences),
  ];
  all.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return priority(b) - priority(a);
  });
  // 相邻模板命中（来自不同正则同一词）去重：间隔 ≤5 字符且均为 template 时只保留前者
  const deduped: AiFlavorIssue[] = [];
  for (const issue of all) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.kind === 'template' && issue.kind === 'template' && issue.start - prev.end <= 5) {
      continue;
    }
    deduped.push(issue);
  }
  return deduped;
}
