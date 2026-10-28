// sight-folio: Show-not-Tell 顾问（写作方案 B3 · 纯规则层）
// 识别"情绪直述"句（短句 + 抽象情绪词 + 无动作/感官/比喻细节支撑），
// 给出方向性改写建议与一句示范改写，供 ShowTellPanel 展示。
// 检测谓词与 A2 同口径（splitSentences + VAGUE_WORDS 均复用于 aiFlavorEngine），
// 额外要求"无细节支撑"以避免打扰 C1 已判为"以行写情"的句子。
import { VAGUE_WORDS, splitSentences } from '../editor/proofread/aiFlavorEngine';

export type ShowTellKind = 'joy' | 'sadness' | 'fear' | 'anger' | 'love' | 'calm' | 'tension' | 'general';

export interface ShowTellIssue {
  /** 句首偏移（UTF-16，可直接经 locate 映射回编辑器选区） */
  start: number;
  end: number;
  /** 原句摘录 */
  excerpt: string;
  /** 命中的抽象情绪词 */
  emotionWord: string;
  /** 情绪分类（general = 通用抽象标签，无专属细节方向） */
  emotionKind: ShowTellKind;
  /** 直述原因的一句话说明 */
  short: string;
  /** 2-3 条展示式改写方向（动作/生理/感官/他者反应/环境映射） */
  directions: string[];
  /** 一句示范改写（把情绪标签换成可见细节的句式） */
  rewriteExample: string;
}

/** 情绪词 → 分类映射（VAGUE_WORDS 全表归类；未命中归 general） */
const KIND_MAP: Record<string, ShowTellKind> = {
  开心: 'joy',
  快乐: 'joy',
  高兴: 'joy',
  幸福: 'joy',
  甜蜜: 'joy',
  欣喜: 'joy',
  兴奋: 'joy',
  激动: 'joy',
  浪漫: 'joy',
  温馨: 'joy',
  温暖: 'joy',
  美好: 'joy',
  舒服: 'joy',
  奇妙: 'joy',
  难过: 'sadness',
  伤心: 'sadness',
  悲伤: 'sadness',
  痛苦: 'sadness',
  苦涩: 'sadness',
  心碎: 'sadness',
  沮丧: 'sadness',
  绝望: 'sadness',
  委屈: 'sadness',
  遗憾: 'sadness',
  难受: 'sadness',
  空虚: 'sadness',
  孤独: 'sadness',
  寂寞: 'sadness',
  失望: 'sadness',
  害怕: 'fear',
  恐惧: 'fear',
  惶恐: 'fear',
  无助: 'fear',
  愤怒: 'anger',
  生气: 'anger',
  温柔: 'love',
  心疼: 'love',
  可爱: 'love',
  释然: 'calm',
  放松: 'calm',
  紧张: 'tension',
  焦虑: 'tension',
  压抑: 'tension',
};

const KIND_DIRECTIONS: Record<ShowTellKind, string[]> = {
  joy: [
    '写可见的身体反应：笑出声、眼睛弯起、脚步轻快',
    '借他者反应或环境衬托，让别人先注意到他的变化',
    '给情绪一个具体由头，让欣喜落在某件小事上',
  ],
  sadness: [
    '写动作细节：垂头、抠衣角、沉默着把话咽回去',
    '写生理反应：眼眶发烫、喉咙发紧、呼吸变浅',
    '用环境映射情绪：雨、灯、背影、收起的物件',
  ],
  fear: [
    '写生理反应：手心出汗、心跳加速、屏住呼吸',
    '写行为回避：不敢看、快步走、反复确认门锁',
    '放大感官：声音变尖、时间变慢、熟悉的物件变陌生',
  ],
  anger: [
    '写身体的克制：攥拳又松开、咬肌绷紧、喉结滚动',
    '写破坏性小动作：摔上门、踢开椅子、把纸团攥皱',
    '写迁怒：对无关的人或物突然失去耐心',
  ],
  love: [
    '写凝视与靠近：眼神停留、不自觉地侧过身',
    '写口是心非：找借口多待一会儿、把好东西留给他',
    '写记住小事：他随口提过的细节被她妥帖收好',
  ],
  calm: [
    '写松弛的生理：肩膀沉下来、呼吸变长、步子慢下来',
    '写环境变化衬解脱：灯光变暖、噪音退去、雨停了',
    '写收拾动作：慢慢归置东西，像是终于不赶时间了',
  ],
  tension: [
    '写小动作泄露：敲桌面、看表、反复确认一遍',
    '写身体紧绷：肌肉发硬、胃揪紧、后背绷直',
    '写声音与语速变化：话变短、尾音发颤、突然安静',
  ],
  general: [
    '把抽象评价词换成可被看见的细节：动作、外貌、声音、环境',
    '补一个"为什么"：给这个标签找一句证据，让读者自己下结论',
    '让情绪发生在一个具体场景里，而不是直接说出来',
  ],
};

const KIND_EXAMPLE: Record<ShowTellKind, string> = {
  joy: '她笑起来，眼睛弯成月牙，脚步不自觉地轻快了几分。',
  sadness: '他垂下头，指尖慢慢攥紧衣角，半天没说话。',
  fear: '她的呼吸突然变浅，手心沁出细密的汗。',
  anger: '他攥紧拳头又松开，喉结动了动，一个字也没说。',
  love: '她没看向他，却把杯子往他那边推了推。',
  calm: '他长长呼出一口气，肩膀慢慢沉了下来。',
  tension: '他又看了一眼表，指节在桌沿重重敲了两下。',
  general: '把「情绪词」换成可被看见的动作、生理反应或环境细节，让读者自己读出情绪。',
};

/** 判定"有没有细节支撑"的精简词表：命中任一即认为情绪已经"呈现"了一部分 */
const DETAIL_WORDS = [
  // 动作呈现
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
  '坐',
  '抬头',
  '低头',
  '回头',
  '转身',
  '抬手',
  '放下',
  '拿起',
  '掏',
  '拍',
  '踢',
  '跑',
  '躲',
  '藏',
  '掩',
  '咬',
  '抿',
  '垂下',
  '扬起',
  '迈',
  '踏',
  '拾起',
  '蹲下',
  '起身',
  '皱',
  // 感官细节
  '看',
  '望',
  '凝视',
  '瞥',
  '听',
  '闻',
  '嗅',
  '尝',
  '摸',
  '碰',
  '凉',
  '烫',
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
  '呼吸',
  '心跳',
  '味道',
  '气味',
  // 比喻
  '像',
  '仿佛',
  '如同',
  '宛如',
  '犹如',
  '似的',
];

function bodyLen(s: string): number {
  return s.replace(/[，、：；。！？…\s“”"'‘’（）()【】——《》〈〉:;,.!?…]/g, '').length;
}

export function detectShowTell(text: string): ShowTellIssue[] {
  const issues: ShowTellIssue[] = [];
  const stop = new Set<string>();
  for (const s of splitSentences(text)) {
    const len = bodyLen(s.text);
    if (len > 26) continue;
    // 与 A2 同口径：命中情绪词是前提
    const hit = VAGUE_WORDS.find((w) => s.text.includes(w));
    if (!hit) continue;
    // 有细节支撑的句子不打扰（C1 视为"以行写情"）
    if (DETAIL_WORDS.some((w) => s.text.includes(w))) continue;
    if (stop.has(hit)) continue; // 同词只在首次出现处给建议
    stop.add(hit);
    const kind = KIND_MAP[hit] ?? 'general';
    issues.push({
      start: s.start,
      end: s.end,
      excerpt: s.text.trim().slice(0, 32),
      emotionWord: hit,
      emotionKind: kind,
      short: `「${hit}」是抽象情绪标签，句子没有给读者可看见的细节`,
      directions: KIND_DIRECTIONS[kind],
      rewriteExample: KIND_EXAMPLE[kind],
    });
  }
  return issues;
}
