import { describe, it, expect } from 'vitest';
import { buildCharactersCorpus, buildCatalogCorpus, buildSettingCorpus } from '../writingAiCorpus';
import type { WritingSetting, WritingChapter, WritingOutline } from '../../services/tauri';

const mkSetting = (over: Partial<WritingSetting>): WritingSetting => ({
  id: 's1',
  bookId: 'b1',
  kind: 'character',
  name: '林默',
  subtitle: '侦探',
  description: '主角',
  extra: '{}',
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('buildCharactersCorpus', () => {
  it('renders character roster with profile fields (bilingual, worldbuilding filtered out)', () => {
    const settings: WritingSetting[] = [
      mkSetting({
        kind: 'character',
        name: '林默',
        subtitle: '侦探',
        extra: JSON.stringify({
          profile: {
            appearance: '高瘦',
            personality: '冷静',
            motivation: '复仇',
            catchphrase: '我知道',
            notes: '关键人物',
          },
        }),
      }),
      mkSetting({ kind: 'worldbuilding', name: '雾都', extra: '{}' }),
    ];
    const c = buildCharactersCorpus(settings);
    expect(c.zh).toContain('【人物卡】');
    expect(c.zh).toContain('林默');
    expect(c.zh).toContain('外貌=高瘦');
    expect(c.zh).toContain('性格=冷静');
    expect(c.zh).toContain('动机=复仇');
    expect(c.zh).toContain('口头禅=我知道');
    // worldbuilding must NOT appear in the character corpus
    expect(c.zh).not.toContain('雾都');
    // english side mirrors
    expect(c.en).toContain('[Characters]');
    expect(c.en).toContain('林默');
  });

  it('falls back to empty marker when no characters', () => {
    expect(buildCharactersCorpus([]).zh).toContain('暂无人物卡');
    expect(buildCharactersCorpus([]).en).toContain('no characters yet');
  });
});

describe('buildCatalogCorpus', () => {
  it('renders volume -> chapter skeleton and loose beats', () => {
    const chapters: WritingChapter[] = [
      {
        id: 'c1',
        bookId: 'b1',
        title: '第一章',
        content: '',
        sortOrder: 1,
        wordCount: 3200,
        status: 'done',
        volume: '卷一',
        kind: 'chapter',
        extra: '{}',
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'c2',
        bookId: 'b1',
        title: '第二章',
        content: '',
        sortOrder: 2,
        wordCount: 2800,
        status: 'draft',
        volume: '卷一',
        kind: 'chapter',
        extra: '{}',
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    const outlines: WritingOutline[] = [
      {
        id: 'o1',
        bookId: 'b1',
        title: '伏笔A',
        summary: '一个秘密',
        chapterId: null,
        extra: '{}',
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    const c = buildCatalogCorpus(chapters, outlines);
    expect(c.zh).toContain('【大纲骨架】');
    expect(c.zh).toContain('卷一');
    expect(c.zh).toContain('第一章');
    expect(c.zh).toContain('3200字');
    expect(c.zh).toContain('伏笔A');
    expect(c.en).toContain('[Outline skeleton]');
  });

  it('falls back when no chapters', () => {
    expect(buildCatalogCorpus([], []).zh).toContain('暂无章节');
  });

  it('caps skeleton chapters with an omission note (bilingual)', () => {
    const chapters: WritingChapter[] = [1, 2, 3, 4, 5].map((n) => ({
      id: `c${n}`,
      bookId: 'b1',
      title: `第${n}章`,
      content: '',
      sortOrder: n,
      wordCount: 1000 + n * 100,
      status: 'draft',
      volume: '卷一',
      kind: 'chapter',
      extra: '{}',
      createdAt: 0,
      updatedAt: 0,
    }));
    const c = buildCatalogCorpus(chapters, [], { chapterLimit: 3 });
    expect(c.zh).toContain('第1章');
    expect(c.zh).toContain('第3章');
    expect(c.zh).not.toContain('第4章');
    expect(c.zh).toContain('其余 2 章省略');
    expect(c.en).toContain('remaining 2 chapters omitted');
  });

  it('keeps full skeleton when chapters are within limit', () => {
    const chapters: WritingChapter[] = [1, 2, 3].map((n) => ({
      id: `c${n}`,
      bookId: 'b1',
      title: `第${n}章`,
      content: '',
      sortOrder: n,
      wordCount: 1000,
      status: 'draft',
      volume: '卷一',
      kind: 'chapter',
      extra: '{}',
      createdAt: 0,
      updatedAt: 0,
    }));
    const c = buildCatalogCorpus(chapters, [], { chapterLimit: 3 });
    expect(c.zh).toContain('第3章');
    expect(c.zh).not.toContain('省略');
  });

  it('omits whole late volumes when limit is exhausted', () => {
    const chapters: WritingChapter[] = [
      {
        id: 'c1',
        bookId: 'b1',
        title: '甲',
        content: '',
        sortOrder: 1,
        wordCount: 1000,
        status: 'done',
        volume: '卷一',
        kind: 'chapter',
        extra: '{}',
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'c2',
        bookId: 'b1',
        title: '乙',
        content: '',
        sortOrder: 1,
        wordCount: 1000,
        status: 'done',
        volume: '卷二',
        kind: 'chapter',
        extra: '{}',
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    const c = buildCatalogCorpus(chapters, [], { chapterLimit: 1 });
    expect(c.zh).toContain('卷一');
    expect(c.zh).not.toContain('卷二');
    expect(c.zh).toContain('其余 1 章省略');
  });
});

describe('buildSettingCorpus', () => {
  it('renders full character profile with relations', () => {
    const s = mkSetting({
      kind: 'character',
      name: '林默',
      subtitle: '侦探',
      description: '本书主角',
      extra: JSON.stringify({
        profile: { appearance: '高瘦', personality: '冷静' },
        relations: [{ target: '雾都', type: '出身地' }],
      }),
    });
    const c = buildSettingCorpus(s);
    expect(c.zh).toContain('聚焦设定：林默');
    expect(c.zh).toContain('类型=人物');
    expect(c.zh).toContain('外貌=高瘦');
    expect(c.zh).toContain('描述：本书主角');
    expect(c.zh).toContain('关系：雾都·出身地');
    expect(c.en).toContain('[Focused setting: 林默');
  });

  it('renders worldbuilding profile', () => {
    const s = mkSetting({
      kind: 'worldbuilding',
      name: '雾都',
      extra: JSON.stringify({ worldbuildingProfile: { type: 'location', rules: '常年多雾' } }),
    });
    const c = buildSettingCorpus(s);
    expect(c.zh).toContain('类型=世界观（location）');
    expect(c.zh).toContain('规则=常年多雾');
  });
});
