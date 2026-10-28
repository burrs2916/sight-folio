// sight-folio: 语料命中句手法拆解（写作方案 C1 · 纯规则层）
// 输入：一句语料库原文；输出：手法标签 + 拆解视图数据（节奏/用词/情感逻辑/可迁移模板/仿写）。
// 定位：CorpusReferencePanel 命中卡片上的「手法拆解」折叠区。
// 说明：模板与仿写示例是句式示范素材（占位符句），非界面文案，不进入 i18n。

export type CraftTagKey =
  | 'sensory' // 感官细节
  | 'action' // 动作呈现
  | 'dialogue' // 对话驱动
  | 'metaphor' // 比喻转写
  | 'short-beat' // 短句点刹
  | 'long-spread' // 长句铺陈
  | 'emotion-told' // 情绪直述（提示改写）
  | 'emotion-shown'; // 以行写情（情绪词 + 细节支撑）

export type CraftRhythm = 'short-beat' | 'steady' | 'long-spread' | 'mixed';
export type CraftEmotionLogic = 'told' | 'shown' | 'none';

export interface CraftBreakdown {
  /** 命中的手法标签（渲染为 chip；空数组 = 不含明显可拆解手法，UI 不展示入口） */
  tags: CraftTagKey[];
  /** 节奏判断 */
  rhythm: CraftRhythm;
  /** 用词亮点：按类别收集命中的具体词，供拆解视图展示 */
  diction: { kind: 'sensory' | 'action' | 'emotion'; words: string[] }[];
  /** 情感逻辑结论 */
  emotionLogic: CraftEmotionLogic;
  /** 可迁移句式模板（占位符句，可直接套用） */
  template: string;
  /** 仿写示范句（中性意象填充模板的示例） */
  imitation: string;
}

/** 感官词（视听触嗅觉线索，含常见具象化搭配） */
const SENSORY_WORDS = [
  '看',
  '望',
  '凝视',
  '瞥',
  '听',
  '闻',
  '嗅',
  '尝',
  '触',
  '摸',
  '碰',
  '凉',
  '烫',
  '热',
  '冷',
  '香',
  '甜',
  '涩',
  '苦',
  '疼',
  '痛',
  '光',
  '影',
  '声',
  '响',
  '味道',
  '气味',
  '呼吸',
  '心跳',
];

/** 动作呈现词（具体到可被读者看见的行为） */
const ACTION_WORDS = [
  '推',
  '拉',
  '握',
  '攥',
  '抓',
  '抱',
  '扶',
  '转',
  '走',
  '停',
  '站',
  '蹲',
  '跪',
  '坐',
  '抬头',
  '低头',
  '回头',
  '转身',
  '抬手',
  '放下',
  '拿起',
  '掏',
  '放',
  '拾',
  '系',
  '拍',
  '踢',
  '跑',
  '奔',
  '追',
  '躲',
  '藏',
  '掩',
  '咬',
  '抿',
  '攥紧',
  '松开',
  '垂下',
  '扬起',
  '迈',
  '跨',
  '踏',
  '拾起',
  '蹲下',
  '起身',
];

/** 抽象情绪直述词（与 A2 检测口径同源；无需 A 开头，按出现即判） */
const EMOTION_WORDS = [
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

const METAPHOR_WORDS = ['像', '仿佛', '如同', '宛如', '犹如', '似的'];

/** 去标点与空白后的正文长度 */
function bodyLen(s: string): number {
  return s.replace(/[，、：；。！？…\s“”"'‘’（）()【】——《》〈〉:;,.!?…]/g, '').length;
}

export function analyzeCraft(sentence: string): CraftBreakdown {
  const text = sentence.trim();
  const len = bodyLen(text);

  const sensoryHits = SENSORY_WORDS.filter((w) => text.includes(w));
  const actionHits = ACTION_WORDS.filter((w) => text.includes(w));
  const emotionHits = EMOTION_WORDS.filter((w) => text.includes(w));
  const metaphorHit = METAPHOR_WORDS.find((w) => text.includes(w));
  const hasDialogue = /[“"「『]/.test(text);
  const commas = (text.match(/[，、；]/g) || []).length;

  // ── 节奏判定 ──
  const rhythm: CraftRhythm = (() => {
    if (len <= 10) return 'short-beat';
    if (len >= 34) return 'long-spread';
    // 长句但逗号切出不短：仍视长句铺陈
    if (len >= 22 && commas >= 3) return 'long-spread';
    // 短句为主 + 有逗号打断：节奏错落
    if (len <= 18 && commas >= 1) return 'mixed';
    return 'steady';
  })();

  // ── 情感逻辑 ──
  let emotionLogic: CraftEmotionLogic = 'none';
  if (emotionHits.length > 0) {
    const hasDetail = sensoryHits.length > 0 || actionHits.length > 0 || metaphorHit;
    emotionLogic = hasDetail ? 'shown' : 'told';
  }

  // ── 手法标签 ──
  const tags = new Set<CraftTagKey>();
  if (sensoryHits.length > 0) tags.add('sensory');
  if (actionHits.length > 0) tags.add('action');
  if (hasDialogue) tags.add('dialogue');
  if (metaphorHit) tags.add('metaphor');
  if (rhythm === 'short-beat') tags.add('short-beat');
  if (rhythm === 'long-spread') tags.add('long-spread');
  if (emotionLogic === 'told') tags.add('emotion-told');
  if (emotionLogic === 'shown') tags.add('emotion-shown');

  // ── 可迁移模板 + 仿写示范（按节奏/手法组合选取句式骨架）──
  const { template, imitation } = pickTemplate(tags, rhythm, emotionLogic);

  return {
    tags: [...tags],
    rhythm,
    diction: [
      ...(sensoryHits.length > 0 ? [{ kind: 'sensory' as const, words: sensoryHits.slice(0, 6) }] : []),
      ...(actionHits.length > 0 ? [{ kind: 'action' as const, words: actionHits.slice(0, 6) }] : []),
      ...(emotionHits.length > 0 ? [{ kind: 'emotion' as const, words: emotionHits.slice(0, 4) }] : []),
    ],
    emotionLogic,
    template,
    imitation,
  };
}

function pickTemplate(
  tags: Set<CraftTagKey>,
  rhythm: CraftRhythm,
  emotionLogic: CraftEmotionLogic,
): { template: string; imitation: string } {
  if (emotionLogic === 'told') {
    return {
      template: '「{人物}{动作}，{生理/环境细节}。」—— 把情绪名词换成可被看见的行为',
      imitation: '他攥紧茶杯，指节发白。',
    };
  }
  if (tags.has('metaphor')) {
    return {
      template: '「{本体}像{喻体}，{延伸细节}。」',
      imitation: '夜色像潮水漫过窗台，凉意跟着爬上来。',
    };
  }
  if (tags.has('dialogue')) {
    return {
      template: '「{对白}」，{人物}{动作}。',
      imitation: '“真的吗？”她低下头，睫毛轻轻一颤。',
    };
  }
  if (rhythm === 'short-beat') {
    return {
      template: '「{人物}{动作}。{短句点刹}。」',
      imitation: '她拉开门。雨声涌进来。',
    };
  }
  if (rhythm === 'long-spread') {
    return {
      template: '「{场景}，{人物}{动作}，{环境反应}。」',
      imitation: '巷口的风裹着桂花香，老人拢了拢衣领，路灯在他身后拉出长长的影子。',
    };
  }
  if (tags.has('action') || tags.has('sensory')) {
    return {
      template: '「{人物}{动作}{感官细节}。」',
      imitation: '他停住脚步，望向窗外起伏的暮色。',
    };
  }
  return {
    template: '「{人物}{动作}{细节}。」',
    imitation: '他转过脸，把这句话咽了回去。',
  };
}
