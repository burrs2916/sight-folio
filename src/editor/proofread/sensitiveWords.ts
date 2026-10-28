// sight-folio: 敏感词/违规词库（前端轻量过滤用，非 exhaustive）
// 场景：写作台自动检测正文，提示作者注意合规风险。
// 维护：按语境严重程度分为 warning / block 两级；UI 统一标红，block 额外警告。
/** 敏感词条目。导出以便自定义词库复用同一形状，避免两处各写一份 `{word, level}` 字面量类型 */
export interface SensitiveEntry {
  word: string;
  level: 'warning' | 'block';
}

export const SENSITIVE_WORDS: SensitiveEntry[] = [
  // 政治敏感
  { word: '法轮功', level: 'block' },
  { word: '台独', level: 'block' },
  { word: '藏独', level: 'block' },
  { word: '疆独', level: 'block' },
  { word: '东突', level: 'block' },
  { word: '达赖', level: 'warning' },
  { word: '十四世', level: 'warning' },
  { word: '邪教', level: 'warning' },
  // 色情/暴力
  { word: '色情', level: 'warning' },
  { word: '淫秽', level: 'warning' },
  { word: '嫖娼', level: 'warning' },
  { word: '强奸', level: 'warning' },
  { word: '杀人', level: 'warning' },
  { word: '自杀', level: 'warning' },
  { word: '跳楼', level: 'warning' },
  { word: '虐待', level: 'warning' },
  // 毒品/赌博
  { word: '毒品', level: 'block' },
  { word: '吸毒', level: 'block' },
  { word: '赌博', level: 'warning' },
  { word: '赌球', level: 'block' },
  { word: '六合彩', level: 'block' },
  // 其他
  { word: '迷信', level: 'warning' },
  { word: '诈骗', level: 'warning' },
  { word: '传销', level: 'block' },
  { word: '黑客', level: 'warning' },
  { word: '翻墙', level: 'warning' },
];

/** 按词长降序排列，保证长词优先匹配 */
export const SENSITIVE_WORDS_SORTED = [...SENSITIVE_WORDS].sort((a, b) => b.word.length - a.word.length);
