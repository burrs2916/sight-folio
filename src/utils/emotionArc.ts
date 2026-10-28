// sight-folio: 情感弧线分析（写作方案 A3 · 纯规则层）
// 输入：章节纯文本；输出：按段落的情感强度（1-5）、主导情绪、平淡区与断层标记。
// 定位：WritingPage AI 菜单「情感弧线分析」→ EmotionArcPanel。
// 口径：段落按换行切分（编辑器段落即 \n）；start/end 为纯文本 UTF-16 偏移，可经 locate 映射回编辑器。

export type ArcEmotion = 'joy' | 'sadness' | 'fear' | 'anger' | 'love' | 'calm' | 'tension' | 'none';

export interface EmotionArcSegment {
  /** 段落序号（0 基，对应渲染列表顺序） */
  index: number;
  /** 段落纯文本（完整原文，供展示与定位） */
  text: string;
  /** 在纯文本中的起始偏移 */
  start: number;
  /** 结束偏移（不含段落分隔换行） */
  end: number;
  /** 主导情绪（无情绪词为 none） */
  emotion: ArcEmotion;
  /** 情感强度 1-5 */
  intensity: number;
  /** 平淡区：自身与相邻段均低强度且无情绪词（连续 ≥2 段） */
  flat: boolean;
  /** 断层：与上一段相比情绪强跳跃（强度差 ≥3 或主导情绪类型剧变） */
  breakpoint: boolean;
}

/** 情绪类别 → 词表（用于主导情绪判定；词按类别唯一归组，避免交叉污染判定） */
const EMOTION_LABELS: Record<Exclude<ArcEmotion, 'none'>, string[]> = {
  joy: ['开心', '快乐', '高兴', '欣喜', '欢快', '幸福', '甜蜜', '兴奋', '愉悦', '雀跃'],
  sadness: ['难过', '伤心', '悲伤', '痛苦', '苦涩', '心碎', '沮丧', '绝望', '失落', '委屈', '遗憾', '伤感'],
  fear: ['害怕', '恐惧', '惶恐', '惊慌', '惊惧', '不安', '忐忑', '心悸', '惊骇'],
  anger: ['愤怒', '生气', '恼火', '怒火', '恨意', '暴怒', '愤懑'],
  love: ['温柔', '依恋', '眷恋', '心疼', '怜惜', '不舍', '心动', '爱意', '温情'],
  calm: ['释然', '平静', '安宁', '放松', '解脱', '淡然', '松弛', '安稳'],
  tension: ['紧张', '焦虑', '压抑', '绷紧', '窒息', '焦灼', '揪心', '煎熬'],
};

const ALL_EMOTION_WORDS: { word: string; kind: Exclude<ArcEmotion, 'none'> }[] = (
  Object.entries(EMOTION_LABELS) as [Exclude<ArcEmotion, 'none'>, string[]][]
).flatMap(([kind, words]) => words.map((word) => ({ word, kind })));

/** 强度副词：命中一次整体 +1（封顶 5） */
const INTENSIFIERS = ['极', '非常', '深深', '万分', '几乎', '难以', '再也', '彻底', '拼命'];

/** 按换行切段落，返回含偏移的段落列表（过滤纯空白段） */
function splitParagraphs(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const re = /[^\n]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    out.push({ text: m[0], start, end });
  }
  return out;
}

function analyzeParagraph(chunk: { text: string; start: number; end: number }): {
  emotion: ArcEmotion;
  intensity: number;
  hits: string[];
} {
  const hits: string[] = [];
  const counted = new Set<string>();
  for (const { word } of ALL_EMOTION_WORDS) {
    if (chunk.text.includes(word) && !counted.has(word)) {
      counted.add(word);
      hits.push(word);
    }
  }
  if (hits.length === 0) return { emotion: 'none', intensity: 1, hits: [] };

  // 主导情绪：出现次数最多的类别（并列取最早出现者）
  const counts = new Map<ArcEmotion, number>();
  for (const { word, kind } of ALL_EMOTION_WORDS) {
    if (!chunk.text.includes(word)) continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  let emotion: ArcEmotion = 'none';
  let best = 0;
  for (const [kind, n] of counts) {
    if (n > best) {
      best = n;
      emotion = kind;
    }
  }
  if (emotion === 'none') return { emotion: 'none', intensity: 1, hits };

  // 强度：基础 = 命中情绪词数（1 词 2 分起，防单次提及即高），副词/标点加成
  let score = 2 + Math.min(counts.size, 2) - 1; // 类别数 ∈[1,3] → 2..4
  for (const w of INTENSIFIERS) {
    if (chunk.text.includes(w)) {
      score += 1;
      break;
    }
  }
  if (/[！？!?]/.test(chunk.text)) score += 1;
  const intensity = Math.max(1, Math.min(5, score));
  return { emotion, intensity, hits };
}

export function analyzeEmotionArc(text: string): EmotionArcSegment[] {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length === 0) return [];

  const raw = paragraphs.map((p) => ({ ...p, ...analyzeParagraph(p) }));

  // 平淡区：连续 ≥2 段 emotion=none 且强度 ≤1
  const flatFlags = raw.map(() => false);
  for (let i = 0; i + 1 < raw.length; i++) {
    const a = raw[i];
    const b = raw[i + 1];
    if (a.emotion === 'none' && b.emotion === 'none' && a.intensity <= 1 && b.intensity <= 1) {
      flatFlags[i] = true;
      flatFlags[i + 1] = true;
    }
  }

  // 断层：与上一段相比强度差 ≥3，或主导情绪在「强烈类别」间剧变（joy↔sadness/fear/anger）
  const SHARP_PAIRS: [ArcEmotion, ArcEmotion][] = [
    ['joy', 'sadness'],
    ['joy', 'fear'],
    ['joy', 'anger'],
    ['calm', 'fear'],
    ['calm', 'anger'],
  ];
  const breakFlags = raw.map(() => false);
  for (let i = 1; i < raw.length; i++) {
    const prev = raw[i - 1];
    const cur = raw[i];
    if (prev.emotion !== 'none' && cur.emotion !== 'none' && prev.emotion !== cur.emotion) {
      const sharp = SHARP_PAIRS.some(
        ([a, b]) => (prev.emotion === a && cur.emotion === b) || (prev.emotion === b && cur.emotion === a),
      );
      if (sharp) {
        breakFlags[i] = true;
        continue;
      }
    }
    if (Math.abs(prev.intensity - cur.intensity) >= 3) breakFlags[i] = true;
  }

  return raw.map((r, i) => ({
    index: i,
    text: r.text,
    start: r.start,
    end: r.end,
    emotion: r.emotion,
    intensity: r.intensity,
    flat: flatFlags[i],
    breakpoint: breakFlags[i],
  }));
}
