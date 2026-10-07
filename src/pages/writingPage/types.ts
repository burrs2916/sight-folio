// 写作页前置类型：左侧 Tab 枚举 + 右侧面板 Tab（正文 / 章详情）+ 章节查找替换区间
export type LeftTab = 'chapters' | 'settings' | 'notes';
export type RightTab = 'body' | 'details';

export interface MatchRange {
  from: number;
  to: number;
}
