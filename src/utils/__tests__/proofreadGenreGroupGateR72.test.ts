// ㉬ N-21（2026-11-11 轮 72 续五班）：体检报告的**体裁闸**锁。
//
// 真人原话：「校对、剧情复盘，你还是原来那套东西，我操，你也没改。」
// 实况：`buildProofreadReport` 一套六组打五种载体。现读 `hiddenViewKindsForGenre:197` 的真矩阵 =
// **散文 / 诗集 / 日记三种都藏 `storylines` + `foreshadowing`**（世界观也藏），小说与剧本保留
// （剧本只藏世界观，剧情线与伏笔是戏剧本体）。可体检清单照旧吐「伏笔逾期未回收」「事件未挂线」，
// 等于**催作者去建一栏系统不让他建的东西**，点跳转还是死路（创建入口同张表已闸）。
//
// 本锁钉四件：
//   ① 判据矩阵（真矩阵，不是本班一开始猜的那份 —— 猜错过一次，写在 ⑤）
//   ② 行为：同一份数据，三种藏栏体裁报告里两组 = 0，其余组一条不少
//   ③ 零回归线：不传体裁（老调用点）与小说逐条相同；剧本六组照旧
//   ④ 措辞跟行为一致：三格引导语不再承诺「六组」，小说/剧本那两格不许被顺手改
import { describe, expect, it } from 'vitest';
import {
  PROOFREAD_GROUPS,
  buildProofreadReport,
  proofreadGroupView,
  proofreadGroupVisibleForGenre,
  type ProofreadGroup,
} from '../writingProofread';
import type { WritingChapter, WritingForeshadowing, WritingOutline, WritingTimelineEvent } from '../../services/tauri';
import zh from '../../i18n/zh-CN.json';
import en from '../../i18n/en-US.json';

const ch = (id: string, content = '', wordCount = 0, status = 'finished'): WritingChapter =>
  ({
    id,
    bookId: 'b1',
    parentId: null,
    title: `章 ${id}`,
    content,
    sortOrder: 0,
    wordCount,
    status,
    volume: '',
    kind: '章',
    extra: '{}',
    createdAt: 0,
    updatedAt: 0,
  }) as WritingChapter;

const beat = (id: string): WritingOutline =>
  ({
    id,
    bookId: 'b1',
    title: `节拍 ${id}`,
    summary: '',
    chapterId: null,
    extra: '{}',
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  }) as WritingOutline;

const ev = (id: string, at: string, storylineId: string | null = null): WritingTimelineEvent =>
  ({
    id,
    bookId: 'b1',
    settingId: null,
    at,
    event: `事件 ${id}`,
    chapterId: null,
    storylineId,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  }) as WritingTimelineEvent;

/** 逾期判据 `isOverdue`：只认 `status === 'pending'` 且 回收章序 ≤ 埋设章序（本班第一版写成
 *  'open' 于是整组恒 0，测试当场把「fixture 造错」与「闸门生效」混成一片红 —— 记在这里） */
const fs = (id: string, plant: string, payoff: string): WritingForeshadowing =>
  ({
    id,
    bookId: 'b1',
    title: `伏笔 ${id}`,
    description: '',
    plantChapterId: plant,
    payoffChapterId: payoff,
    storylineId: null,
    status: 'pending',
    sortOrder: 0,
    extra: '{}',
    createdAt: 0,
    updatedAt: 0,
  }) as WritingForeshadowing;

/** 一份同时命中 ①③④⑤⑥ 的输入（六组维度里除一致性外全中；一致性要 settings，另测） */
const input = () => ({
  chapters: [ch('ch1', '他行事一诺千斤。', 40), ch('ch2', '正文', 100), ch('ch3', '', 0)],
  outlines: [beat('b1')],
  events: [ev('e1', '第三日'), ev('e2', '第三日'), ev('e3', ''), ev('e4', '第五日', 'sl1')],
  foreshadowings: [fs('f1', 'ch2', 'ch1')],
  storylines: [{ id: 'sl1' }],
});

const reportFor = (genre: string) => {
  const i = input();
  return buildProofreadReport(i.chapters, i.outlines, i.events, i.foreshadowings, i.storylines, [], genre);
};

/** 真矩阵：藏这两栏的三种体裁 */
const CUT: readonly string[] = ['diary', 'essay', 'poetry'];
/** 保留这两栏的：小说、剧本（剧本只藏世界观）+ 未设/脏体裁落回历史行为 */
const KEEP: readonly string[] = ['novel', 'script', '', 'xxx'];

describe('㉬ N-21 · 判据矩阵', () => {
  const groups = PROOFREAD_GROUPS;
  it('散文 / 诗集 / 日记砍 伏笔+剧情线；小说 / 剧本 / 未设 六组全在', () => {
    for (const g of groups) {
      const cuttable = g === 'foreshadow' || g === 'storyline';
      for (const genre of CUT) {
        expect(proofreadGroupVisibleForGenre(genre, g), `${genre}/${g}`).toBe(!cuttable);
      }
      for (const genre of KEEP) {
        expect(proofreadGroupVisibleForGenre(genre, g), `${genre}/${g}`).toBe(true);
      }
    }
  });

  it('判据不许另立第二张表：用房面映射 `proofreadGroupView` 的现读值反推', () => {
    expect(proofreadGroupView('foreshadow')).toBe('foreshadowing');
    expect(proofreadGroupView('storyline')).toBe('storylines');
    // 一致性指向 characters（人物栏三种体裁都留）⇒ 不许被顺手砍
    expect(proofreadGroupView('consistency')).toBe('characters');
    for (const genre of CUT) expect(proofreadGroupVisibleForGenre(genre, 'consistency')).toBe(true);
    // 没有对应页签的组恒放行
    expect(proofreadGroupView('chapter-text')).toBeNull();
    expect(proofreadGroupVisibleForGenre('diary', 'chapter-text')).toBe(true);
  });
});

describe('㉬ N-21 · 报告行为', () => {
  it('基线自证：不传体裁时这六组确实命中（否则下面的 0 全是假的）', () => {
    const r = reportFor('');
    expect(r.counts['foreshadow']).toBe(1);
    expect(r.counts['storyline']).toBe(2); // 未挂线汇总 + sl1 悬空线
    expect(r.counts['chapter-text']).toBeGreaterThan(0);
    expect(r.counts['timeline']).toBeGreaterThan(0);
    expect(r.counts['idea']).toBe(1);
  });

  it('三种藏栏体裁：两组归零，其余组一条不少', () => {
    const base = reportFor('');
    for (const genre of CUT) {
      const r = reportFor(genre);
      expect(r.counts['foreshadow'], genre).toBe(0);
      expect(r.counts['storyline'], genre).toBe(0);
      expect(r.issues.some((i) => i.group === 'foreshadow' || i.key.startsWith('sl:')), genre).toBe(false);
      for (const g of ['chapter-text', 'timeline', 'idea'] as ProofreadGroup[]) {
        expect(r.counts[g], `${genre} 误砍 ${g}`).toBe(base.counts[g]);
      }
    }
  });

  it('零回归线：不传体裁（老调用点）与小说逐条相同；剧本六组照旧', () => {
    const i = input();
    const legacy = buildProofreadReport(i.chapters, i.outlines, i.events, i.foreshadowings, i.storylines, []);
    const novel = buildProofreadReport(i.chapters, i.outlines, i.events, i.foreshadowings, i.storylines, [], 'novel');
    expect(legacy.issues.map((x) => x.key)).toEqual(novel.issues.map((x) => x.key));
    expect(legacy.counts).toEqual(novel.counts);
    const script = reportFor('script');
    expect(script.counts).toEqual(legacy.counts);
  });
});

describe('㉬ N-21 · 措辞必须跟行为一致', () => {
  const hint = (bag: unknown, path: string[]) =>
    path.reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], bag) as string;

  it('藏栏的三格不再承诺「六组」，改口四组', () => {
    for (const g of CUT) {
      const z = hint(zh, ['writing', g, 'proofreadHint']);
      const e = hint(en, ['writing', g, 'proofreadHint']);
      expect(z, g).toContain('四组');
      expect(z.includes('六组'), `${g} 还在承诺六组`).toBe(false);
      expect(e.toLowerCase(), g).toContain('four groups');
      expect(e.toLowerCase().includes('six groups'), g).toBe(false);
    }
  });

  it('小说（默认格）与剧本那两格不许被顺手改掉——它们真有这六组', () => {
    expect(hint(zh, ['editor', 'writing', 'studioPane', 'proofreadHint'])).toContain('六组');
    expect(hint(zh, ['writing', 'script', 'proofreadHint'])).toContain('六组');
    expect(hint(en, ['editor', 'writing', 'studioPane', 'proofreadHint']).toLowerCase()).toContain('consistency');
  });
});
