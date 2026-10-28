// sight-folio: P0 文风一致性引擎 v1 —— 从已写章节正文提取「文风指纹」。
//
// 定位：给 AI 续写/润色 prompt 注入的统计画像（句式结构 / 段落节奏 / 对话密度 /
// 标点偏好 / 高频词），让输出贴近作者语言风格。口径是「倾向引导」而非硬规则：
// 文本明确说明这是统计画像，AI 应贴近节奏与用词倾向，不当作必须遵守的模板。
//
// 设计约束（与 writingCorpus 同源）：
// - 纯函数 + 零 React/store 依赖，单测直接跑；
// - 样本按 sortOrder 取前 N 章、累计截断到预算字符（上限常量见 writingCorpusBudget）；
// - HTML 拍平复用 writingCorpus 的 stripChapterHtml，保证与注入样本口径一致；
// - 词汇分析为无词典近似：中文用双字窗口（bigram）频次、英文按空格分词，仅作用词倾向参考。

import type { WritingChapter } from '../services/tauri';
import { stripChapterHtml } from './writingCorpus';
import {
  STYLE_FINGERPRINT_MAX_CHAPTERS,
  STYLE_FINGERPRINT_MAX_CHARS,
  STYLE_FINGERPRINT_MIN_CHARS,
  STYLE_FINGERPRINT_TOP_WORDS,
} from './writingCorpusBudget';

// ─── 统计口径常量 ───

/** 句长分档（按字符）：短句 / 中句 / 长句 */
const SHORT_SENTENCE_CHARS = 15;
const LONG_SENTENCE_CHARS = 40;

/** 段长分档（按字符）：短段 / 中段 / 长段 */
const SHORT_PARAGRAPH_CHARS = 30;
const LONG_PARAGRAPH_CHARS = 100;

/** 中文助词/虚词停用字（bigram 含其一即跳过，降低噪声） */
const STOP_CHARS = new Set(
  '的了是在有和我就不人都一个上也很到说要去你会看着没有这那为与及等地的得呢吗吧啊呀哦他她它我们你们他们什么怎么着被把给从对向还又再才只但而或者其所以因',
);

/** 英文常见停用词（小写、去标点后比较） */
const EN_STOP_WORDS = new Set([
  'the',
  'and',
  'was',
  'for',
  'that',
  'with',
  'this',
  'have',
  'from',
  'had',
  'not',
  'but',
  'his',
  'her',
  'they',
  'she',
  'were',
  'been',
  'are',
  'has',
  'will',
  'would',
  'could',
  'should',
  'there',
  'their',
  'what',
  'when',
  'where',
  'which',
  'while',
  'about',
  'into',
  'over',
  'than',
  'then',
  'these',
  'those',
  'because',
  'before',
  'after',
  'upon',
  'said',
  'like',
]);

// ─── 指纹结果类型 ───

export interface StyleFingerprint {
  /** 参与统计的样本字符数（不含标点剥离，为原始正文长度） */
  sampleChars: number;
  /** 句子数（按 。！？!?；;\n 切分） */
  sentenceCount: number;
  sentenceStats: {
    avgChars: number;
    shortPct: number;
    mediumPct: number;
    longPct: number;
  };
  paragraphStats: {
    count: number;
    avgChars: number;
    shortPct: number;
    mediumPct: number;
    longPct: number;
  };
  /** 引号对话内容占全文的百分比（0-100） */
  dialoguePct: number;
  /** 标点偏好：各项为「每千字出现次数」（commaPerSentence 除外，为每句逗号数） */
  punctuation: {
    ellipsisPerThousand: number;
    exclaimPerThousand: number;
    questionPerThousand: number;
    colonPerThousand: number;
    commaPerSentence: number;
  };
  /** 高频词（各自按语言独立统计，按频次降序） */
  topWordsZh: string[];
  topWordsEn: string[];
}

// ─── 内部工具 ───

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function perThousand(count: number, chars: number): number {
  return chars > 0 ? Math.round((count / chars) * 10000) / 10 : 0;
}

function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?；;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 抽取中文高频双字窗口（bigram），过滤含停用字/非汉字的组合 */
function collectChineseBigrams(text: string): Map<string, number> {
  const freq = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const a = text[i];
    const b = text[i + 1];
    if (!isHan(a) || !isHan(b)) continue;
    if (STOP_CHARS.has(a) || STOP_CHARS.has(b)) continue;
    const key = a + b;
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  return freq;
}

/** 抽取英文高频词（小写、去首尾撇号连字符、过滤停用词与过短词） */
function collectEnglishWords(text: string): Map<string, number> {
  const freq = new Map<string, number>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z'-]{1,}/g) ?? []) {
    const w = raw.replace(/^['-]+|['-]+$/g, '');
    if (w.length < 3 || EN_STOP_WORDS.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return freq;
}

function isHan(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0x4e00 && code <= 0x9fff;
}

function topKeys(freq: Map<string, number>, n: number): string[] {
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

// ─── 主分析函数 ───

/**
 * 从纯文本样本计算文风指纹。文本应为已拍平的章节正文（多个章节可直接 join('\n\n')）。
 * 不做预算截断——预算由 buildStyleFingerprint 在进入前完成，此处保持纯计算便于单测。
 */
export function analyzeStyleFingerprint(texts: string[]): StyleFingerprint {
  const text = texts.join('\n\n');
  const chars = text.length;

  // 句式
  const sentences = splitSentences(text);
  const sentenceCount = sentences.length;
  const sentenceChars = sentenceCount > 0 ? sentences.reduce((s, x) => s + x.length, 0) : 0;
  const sShort = sentences.filter((s) => s.length < SHORT_SENTENCE_CHARS).length;
  const sLong = sentences.filter((s) => s.length > LONG_SENTENCE_CHARS).length;

  // 段落
  const paragraphs = splitParagraphs(text);
  const paragraphCount = paragraphs.length;
  const pShort = paragraphs.filter((p) => p.length < SHORT_PARAGRAPH_CHARS).length;
  const pLong = paragraphs.filter((p) => p.length > LONG_PARAGRAPH_CHARS).length;

  // 对话密度：引号内内容字符数占全文比例
  const quotedChars = (text.match(/[“"「『]([\s\S]*?)[”"」』]/g) ?? []).reduce((sum, q) => sum + q.length, 0);

  // 标点偏好（每千字）
  const ellipsisCount = (text.match(/…/g) ?? []).length;
  const exclaimCount = (text.match(/[！!]/g) ?? []).length;
  const questionCount = (text.match(/[？?]/g) ?? []).length;
  const colonCount = (text.match(/[：:]/g) ?? []).length;
  const commaCount = (text.match(/[,，]/g) ?? []).length;

  // 高频词（中英独立）
  const zhFreq = collectChineseBigrams(text.replace(/[“”"「」『』]/g, ''));
  const enFreq = collectEnglishWords(text);

  return {
    sampleChars: chars,
    sentenceCount,
    sentenceStats: {
      avgChars: sentenceCount > 0 ? Math.round(sentenceChars / sentenceCount) : 0,
      shortPct: pct(sShort, sentenceCount),
      mediumPct: pct(sentenceCount - sShort - sLong, sentenceCount),
      longPct: pct(sLong, sentenceCount),
    },
    paragraphStats: {
      count: paragraphCount,
      avgChars: paragraphCount > 0 ? Math.round(chars / paragraphCount) : 0,
      shortPct: pct(pShort, paragraphCount),
      mediumPct: pct(paragraphCount - pShort - pLong, paragraphCount),
      longPct: pct(pLong, paragraphCount),
    },
    dialoguePct: chars > 0 ? Math.round((quotedChars / chars) * 100) : 0,
    punctuation: {
      ellipsisPerThousand: perThousand(ellipsisCount, chars),
      exclaimPerThousand: perThousand(exclaimCount, chars),
      questionPerThousand: perThousand(questionCount, chars),
      colonPerThousand: perThousand(colonCount, chars),
      commaPerSentence: sentenceCount > 0 ? Math.round((commaCount / sentenceCount) * 10) / 10 : 0,
    },
    topWordsZh: topKeys(zhFreq, STYLE_FINGERPRINT_TOP_WORDS),
    topWordsEn: topKeys(enFreq, STYLE_FINGERPRINT_TOP_WORDS),
  };
}

// ─── 格式化输出 ───

/** 把指纹格式化为供 prompt 注入的引导文本（zh / en） */
export function formatStyleFingerprint(fp: StyleFingerprint, lang: 'zh' | 'en'): string {
  const zh =
    `【文风指纹】（统计画像，基于约 ${fp.sampleChars.toLocaleString()} 字样本）\n` +
    `- 句式：平均句长 ${fp.sentenceStats.avgChars} 字；短句 ${fp.sentenceStats.shortPct}% / 中句 ${fp.sentenceStats.mediumPct}% / 长句 ${fp.sentenceStats.longPct}%\n` +
    `- 段落：平均段长 ${fp.paragraphStats.avgChars} 字；短段 ${fp.paragraphStats.shortPct}% / 中段 ${fp.paragraphStats.mediumPct}% / 长段 ${fp.paragraphStats.longPct}%\n` +
    `- 对话：引号内容约占总篇幅 ${fp.dialoguePct}%\n` +
    `- 标点：省略号 ${fp.punctuation.ellipsisPerThousand}/千字；感叹号 ${fp.punctuation.exclaimPerThousand}/千字；问号 ${fp.punctuation.questionPerThousand}/千字；逗号平均每句 ${fp.punctuation.commaPerSentence} 个\n` +
    (fp.topWordsZh.length > 0 ? `- 高频用词倾向：${fp.topWordsZh.join('、')}\n` : '') +
    '（写作时请贴近以上句式节奏与用词倾向，但保持自然，不要刻意堆砌高频词。）';

  const en =
    `[Style fingerprint] (statistical profile, from a ~${fp.sampleChars.toLocaleString()}-char sample)\n` +
    `- Sentence: avg ${fp.sentenceStats.avgChars} chars; short ${fp.sentenceStats.shortPct}% / medium ${fp.sentenceStats.mediumPct}% / long ${fp.sentenceStats.longPct}%\n` +
    `- Paragraph: avg ${fp.paragraphStats.avgChars} chars; short ${fp.paragraphStats.shortPct}% / medium ${fp.paragraphStats.mediumPct}% / long ${fp.paragraphStats.longPct}%\n` +
    `- Dialogue: quoted content ~${fp.dialoguePct}% of text\n` +
    `- Punctuation: ellipsis ${fp.punctuation.ellipsisPerThousand}/1k chars; exclamation ${fp.punctuation.exclaimPerThousand}/1k; question ${fp.punctuation.questionPerThousand}/1k; comma avg ${fp.punctuation.commaPerSentence} per sentence\n` +
    (fp.topWordsEn.length > 0 ? `- Word preference: ${fp.topWordsEn.join(', ')}\n` : '') +
    '(Match the sentence rhythm and word preference above, but stay natural; do not force high-frequency words.)';

  return lang === 'zh' ? zh : en;
}

/**
 * 从章节列表构建文风指纹（zh/en）。按 sortOrder 取前 N 章、累计截断到预算字符；
 * 样本不足最小字数（无可画像风格）时返回 null，调用方选择不注入。
 */
export function buildStyleFingerprint(chapters: WritingChapter[]): { zh: string; en: string } | null {
  const sorted = [...chapters].sort((a, b) => a.sortOrder - b.sortOrder);
  const texts: string[] = [];
  let budget = STYLE_FINGERPRINT_MAX_CHARS;
  for (const c of sorted.slice(0, STYLE_FINGERPRINT_MAX_CHAPTERS)) {
    const text = stripChapterHtml(c.content ?? '');
    if (!text) continue;
    if (text.length > budget) {
      texts.push(text.slice(0, budget));
      break;
    }
    texts.push(text);
    budget -= text.length;
  }
  const sampleChars = texts.reduce((s, t) => s + t.length, 0);
  if (sampleChars < STYLE_FINGERPRINT_MIN_CHARS) return null;

  const fp = analyzeStyleFingerprint(texts);
  return { zh: formatStyleFingerprint(fp, 'zh'), en: formatStyleFingerprint(fp, 'en') };
}
