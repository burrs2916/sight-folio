// sight-folio: 冗余表达词表（批次④ T2）
// 语义冗余固定搭配：短语的核心词已完整包含修饰词的含义（「凯旋」=「胜利归来」），
// 命中即确定冗余，不会误伤正常修辞。与 typoPhrases 词表刻意不重叠。
// fix 一律为精简词，仅在用户逐条点击「一键修复」后替换，符合「绝无静默改写」红线。
export interface RedundantPhrase {
  wrong: string;
  right: string;
}

export const REDUNDANT_PHRASES: RedundantPhrase[] = [
  { wrong: '凯旋而归', right: '凯旋' },
  { wrong: '胜利凯旋', right: '凯旋' },
  { wrong: '亲眼目睹', right: '目睹' },
  { wrong: '大声呐喊', right: '呐喊' },
  { wrong: '再次复发', right: '复发' },
  { wrong: '共同协商', right: '协商' },
  { wrong: '彻底根治', right: '根治' },
];
