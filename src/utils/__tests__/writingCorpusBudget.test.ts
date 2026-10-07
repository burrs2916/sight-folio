// sight-folio: 语料预算常量测试 —— 锁定时长参数不回退、端点 profile 与常量同源。

import { describe, expect, it } from 'vitest';
import {
  MAX_CONFLICT_TEXTS,
  MAX_TEXT_ISSUE_CHAPTERS,
  MAX_OUTLIER_ROWS,
  MAX_SKELETON_CHAPTERS,
  MANUSCRIPT_PREV_COUNT,
  MANUSCRIPT_TAIL_CHARS,
  MAX_LOOSE_BEATS,
  CHAT_CONTEXT_PROFILE,
} from '../writingCorpusBudget';

describe('writingCorpusBudget 预算常量', () => {
  it('语料片段上限常量存在且为有限正整数', () => {
    const caps = [
      MAX_CONFLICT_TEXTS,
      MAX_TEXT_ISSUE_CHAPTERS,
      MAX_OUTLIER_ROWS,
      MAX_SKELETON_CHAPTERS,
      MANUSCRIPT_PREV_COUNT,
      MANUSCRIPT_TAIL_CHARS,
      MAX_LOOSE_BEATS,
    ];
    for (const v of caps) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it('写作台聊天端 profile 与常量同源', () => {
    expect(CHAT_CONTEXT_PROFILE.tailChars).toBe(2000);
    expect(CHAT_CONTEXT_PROFILE.charProfiles).toBe(40);
    expect(CHAT_CONTEXT_PROFILE.worldbuildingEntries).toBe(40);
    expect(CHAT_CONTEXT_PROFILE.catalogChapterLimit).toBe(60);
  });

  it('骨架与正文截断量级合理（骨架不超长书、前情保留上下文）', () => {
    expect(MAX_SKELETON_CHAPTERS).toBeLessThanOrEqual(200);
    expect(MANUSCRIPT_PREV_COUNT).toBeLessThanOrEqual(4);
    expect(MANUSCRIPT_TAIL_CHARS).toBeGreaterThanOrEqual(200);
  });
});
