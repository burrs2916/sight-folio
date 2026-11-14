/**
 * ㉲ AI-3（2026-11-11 轮 33）：注入层按体裁裁段 —— 被裁视图的语料段不再整包塞给模型
 *
 * 病灶（v3 §4 A 族在册，第 3 档队首）：`writingContextProvider.ts` 八段此前**无条件**进 pack，
 * 全文零处 `hiddenViewKindsForGenre`。诗集作者的 Agent 每轮都收到「世界观设定：本书还没有
 * 世界观设定。+ 缺陷标记：设定相关结论请声明盲区」与「伏笔：0 条」两节空壳 —— 注入层在替
 * 一本没有这些栏的书宣布「你有这栏、只是没填」，模型接着就按小说的栏目表去铺承接。
 *
 * 修法与页签 / 入口 / 创建闸口同一张表（`viewKindVisibleForGenre`），并**原样沿用页签侧护栏**
 * （SceneTabBar 的裁剪条件）：本书已建过该类数据 ⇒ 段照旧在 —— 数据不因裁页签而隐身。
 * 时间线合成分节：剧情线子段被裁时节名 / 计数行 / facts 三张嘴同轮收（AU-7 ⑨ 的注入层形态），
 * 判据住在 `writingCorpus.buildTimelineCorpus`（右栏 / 工作台第二消费点同函数、同判据）。
 *
 * 零回归线：novel（含未设置 / 脏值）hidden = ∅ ⇒ 八段全在、三张嘴与合成分段逐字 = 改造前
 * （⑤ 是逐字锁，不是形状锁）。
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach } from 'vitest';
import { useWritingStore } from '../../../store/writingStore';
import { writingContextProvider } from '../writingContextProvider';
import { buildTimelineCorpus } from '../../../utils/writingCorpus';
import type {
  WritingBook,
  WritingChapter,
  WritingForeshadowing,
  WritingSetting,
  WritingStoryline,
} from '../../../services/tauri';

const BOOK_ID = 'book_trim';

const FULL_KEYS = [
  'book-overview',
  'active-chapter',
  'characters',
  'worldbuilding',
  'timeline-storylines',
  'foreshadowing',
  'inspirations',
  'proofread',
];
/** 散文 / 诗歌 / 日记：被裁 世界观 / 剧情线 / 伏笔 三栏（剧情线只摘子段，节本体恒在） */
const TRIM3_KEYS = [
  'book-overview',
  'active-chapter',
  'characters',
  'timeline-storylines',
  'inspirations',
  'proofread',
];
/** 剧本只摘「世界观」：伏笔 / 剧情线是戏剧本体，一枚不许多裁（⑮-2 判定） */
const SCRIPT_KEYS = [
  'book-overview',
  'active-chapter',
  'characters',
  'timeline-storylines',
  'foreshadowing',
  'inspirations',
  'proofread',
];

function makeBook(genre: string): WritingBook {
  return {
    id: BOOK_ID,
    title: '裁段之书',
    description: '',
    genre,
    medium: '',
    status: 'draft',
    coverColor: '#4A338F',
    dailyGoal: 0,
    extra: '{}',
    createdAt: 1000,
    updatedAt: 2000,
  };
}

function makeChapter(partial: Partial<WritingChapter> = {}): WritingChapter {
  return {
    id: `chap_${Math.random().toString(36).slice(2, 8)}`,
    bookId: BOOK_ID,
    title: '甲',
    content: '<p>正文一段。</p>',
    sortOrder: 0,
    wordCount: 10,
    status: 'draft',
    volume: '',
    parentId: null,
    kind: '',
    extra: '{}',
    createdAt: 1000,
    updatedAt: 1000,
    ...partial,
  } as WritingChapter;
}

function makeSetting(kind: 'character' | 'worldbuilding', name: string): WritingSetting {
  return {
    id: `set_${name}`,
    bookId: BOOK_ID,
    kind,
    name,
    subtitle: '',
    description: '描述',
    extra: '{}',
    sortOrder: 1,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makeStoryline(): WritingStoryline {
  return {
    id: 'sl_legacy',
    bookId: BOOK_ID,
    name: '复仇线',
    color: '#4fc3f7',
    description: '',
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeForeshadowing(): WritingForeshadowing {
  return {
    id: 'fs_legacy',
    bookId: BOOK_ID,
    title: '雨夜的怀表',
    description: '',
    plantChapterId: null,
    payoffChapterId: null,
    status: 'pending',
    storylineId: null,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

function packFor(
  genre: string,
  opts: {
    settings?: WritingSetting[];
    storylines?: WritingStoryline[];
    foreshadowings?: WritingForeshadowing[];
  } = {},
) {
  useWritingStore.setState({
    books: [makeBook(genre)],
    activeBookId: BOOK_ID,
    activeChapterId: null,
    chapters: [makeChapter()],
    settings: opts.settings ?? [],
    activeSettingId: null,
    timelineEvents: [],
    storylines: opts.storylines ?? [],
    foreshadowings: opts.foreshadowings ?? [],
    outlines: [],
  });
  return writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
}

const secOf = (p: ReturnType<typeof packFor>, key: string) => p.sections.find((x) => x.key === key)!;

describe('㉲ AI-3 · 注入层按体裁裁段', () => {
  beforeEach(() => {
    useWritingStore.setState({ books: [], activeBookId: null });
  });

  it('诗集（被裁三栏且零数据）：worldbuilding / foreshadowing 两节整段出包，六段形状钉死', () => {
    const p = packFor('poetry', { settings: [makeSetting('character', '阿城')] });
    expect(p.sections.map((x) => x.key)).toEqual(TRIM3_KEYS);
  });

  it('散文集 / 日记集同形；characters 栏未被裁 ⇒ 零卡段仍在，且人设卡豁免未被动到', () => {
    for (const g of ['essay', 'diary']) {
      const p = packFor(g);
      expect(p.sections.map((x) => x.key), `${g} 的段集合漂了`).toEqual(TRIM3_KEYS);
      const chars = secOf(p, 'characters');
      // 段保留的是「栏存在」；缺陷标记按 characterCardsOptionalForGenre 豁免（在册判定，本刀零动）
      expect(chars, `${g} 人物栏整段丢了（裁过头）`).toBeTruthy();
      expect(chars.facts).toMatchObject({ count: 0 });
      expect(chars.dataQuality, `${g} 人物栏被挂上缺陷标记`).toBeUndefined();
    }
  });

  it('剧本只摘世界观：伏笔段恒在，时间线合成段的节名 / 子段 / facts 一字不动', () => {
    const p = packFor('script');
    expect(p.sections.map((x) => x.key)).toEqual(SCRIPT_KEYS);
    const tl = secOf(p, 'timeline-storylines');
    expect(tl.title).toBe('时间线与剧情线');
    expect(tl.summary).toBe('0 条事件 · 0 条剧情线');
    expect(tl.facts).toEqual({ eventCount: 0, storylineCount: 0 });
    expect(tl.content).toContain('【剧情线（0 条）】');
  });

  it('被裁体裁的合成分节三张嘴同收：节名「时间线」、计数行不提剧情线、facts 撤 storylineCount', () => {
    const p = packFor('poetry');
    const tl = secOf(p, 'timeline-storylines');
    expect(tl.title).toBe('时间线');
    expect(tl.summary).toBe('0 条事件');
    expect(tl.facts).toEqual({ eventCount: 0 });
    expect(tl.content).toContain('【诗作骨架】');
    expect(tl.content).not.toContain('【剧情线');
    expect(tl.content).not.toContain('[Storylines');
  });

  it('零回归：小说（未设置 / 脏值体裁）八段全在，合成分节三张嘴逐字 = 改造前', () => {
    for (const g of ['', 'nope']) {
      const p = packFor(g);
      expect(p.sections.map((x) => x.key), `genre='${g}' 段集合漂了`).toEqual(FULL_KEYS);
      const tl = secOf(p, 'timeline-storylines');
      expect(tl.title).toBe('时间线与剧情线');
      expect(tl.summary).toBe('0 条事件 · 0 条剧情线');
      expect(tl.facts).toEqual({ eventCount: 0, storylineCount: 0 });
      expect(tl.content).toContain('【章节骨架】');
      expect(tl.content).toContain('【剧情线（0 条）】');
      expect(tl.content).toContain('（暂无剧情线）');
    }
  });

  it('存量数据不隐身：诗集建过世界观 / 伏笔 / 剧情线 ⇒ 八段回齐、合成分节恢复原文状', () => {
    const p = packFor('poetry', {
      settings: [makeSetting('worldbuilding', '雨城')],
      storylines: [makeStoryline()],
      foreshadowings: [makeForeshadowing()],
    });
    expect(p.sections.map((x) => x.key)).toEqual(FULL_KEYS);
    const tl = secOf(p, 'timeline-storylines');
    expect(tl.title).toBe('时间线与剧情线');
    expect(tl.facts).toEqual({ eventCount: 0, storylineCount: 1 });
    expect(tl.content).toContain('【剧情线（1 条）】');
    expect(tl.content).toContain('复仇线');
    expect(secOf(p, 'worldbuilding').content).toContain('雨城');
    expect(secOf(p, 'foreshadowing').content).toContain('雨夜的怀表');
  });

  it('第二消费点同判据（工作台 / 右栏走同一函数 · builder 层直打四组合）', () => {
    const noLines = buildTimelineCorpus('b1', [], [], [], [], { genre: 'poetry' });
    expect(noLines.zh).not.toContain('【剧情线');
    expect(noLines.en).not.toContain('[Storylines');
    const legacy = buildTimelineCorpus('b1', [], [], [], [makeStoryline()], { genre: 'poetry' });
    expect(legacy.zh).toContain('【剧情线（1 条）】');
    const script = buildTimelineCorpus('b1', [], [], [], [], { genre: 'script' });
    expect(script.zh).toContain('【剧情线（0 条）】');
    const novel = buildTimelineCorpus('b1', [], [], [], [], {});
    expect(novel.zh).toContain('【剧情线（0 条）】');
    expect(novel.zh).toContain('（暂无剧情线）');
  });

  it('源码锁：判据只走同一张表；八段清单不再手摆；体裁字面判据零新增', () => {
    const provider = readFileSync('src/ai/providers/writingContextProvider.ts', 'utf-8');
    const corpus = readFileSync('src/utils/writingCorpus.ts', 'utf-8');
    // 表查了 6 次：合成分节 1 + 八段过滤 5（概览 / 当前章 / 时间线主体三件不上这张表）
    expect(provider.split('viewKindVisibleForGenre(').length - 1).toBe(6);
    expect(provider).toContain('packWithinBudget(packSections');
    // 禁令型（AU-7 ⑧：这里不举被禁形状的反例字面量）——体裁字面等值判据在本文件零出现
    expect(provider).not.toMatch(/genre\s*===\s*['"]/);
    expect(corpus.split('viewKindVisibleForGenre(').length - 1).toBe(1);
    expect(corpus).toContain('const storylinesPruned =');
  });
});
