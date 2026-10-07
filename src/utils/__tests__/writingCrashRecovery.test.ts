// T5 崩溃恢复 · localStorage 兜底草稿层（utils/writingCrashRecovery）回归锁
//
// 锁死四条契约：
// ① save/load/clear 往返与同 key 覆盖（草稿存在 ⟺ 最后一次入库后有未确认输入）；
// ② 坏 JSON / 缺字段读取容错为「无草稿」，清扫时移除坏数据；
// ③ TTL 清扫只清过期草稿，未过期与无关 key 原样保留；
// ④ key 命名带书/章维度且带统一前缀，collect 可枚举。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveDraftSnap,
  loadDraftSnap,
  clearDraftSnap,
  draftKey,
  collectDraftKeys,
  clearExpiredDrafts,
  DRAFT_TTL_MS,
} from '../writingCrashRecovery';

const SECOND = 1000;

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('writingCrashRecovery（T5 崩溃恢复草稿层）', () => {
  it('save → load 往返，字段完整且带时间戳', () => {
    const t0 = Date.now();
    saveDraftSnap('book_1', 'ch_1', '<p>灵感碎片</p>', 12, 'auto');
    const snap = loadDraftSnap('book_1', 'ch_1');
    expect(snap).not.toBeNull();
    expect(snap!.html).toBe('<p>灵感碎片</p>');
    expect(snap!.wordCount).toBe(12);
    expect(snap!.source).toBe('auto');
    expect(snap!.savedAt).toBeGreaterThanOrEqual(Math.floor(t0 / 1000));
  });

  it('同书章覆盖仅存最新一份；clear 后返回 null', () => {
    saveDraftSnap('book_1', 'ch_1', '<p>v1</p>', 1);
    saveDraftSnap('book_1', 'ch_1', '<p>v2</p>', 2);
    expect(loadDraftSnap('book_1', 'ch_1')!.html).toBe('<p>v2</p>');
    expect(collectDraftKeys()).toEqual([draftKey('book_1', 'ch_1')]);
    clearDraftSnap('book_1', 'ch_1');
    expect(loadDraftSnap('book_1', 'ch_1')).toBeNull();
    expect(collectDraftKeys()).toEqual([]);
  });

  it('key 带书/章双维度，互不干扰', () => {
    saveDraftSnap('book_1', 'ch_1', '<p>a</p>', 1);
    saveDraftSnap('book_1', 'ch_2', '<p>b</p>', 1);
    saveDraftSnap('book_2', 'ch_1', '<p>c</p>', 1);
    expect(collectDraftKeys()).toHaveLength(3);
    clearDraftSnap('book_1', 'ch_1');
    expect(loadDraftSnap('book_1', 'ch_2')).not.toBeNull();
    expect(loadDraftSnap('book_2', 'ch_1')).not.toBeNull();
  });

  it('坏 JSON / 缺字段读取容错为无草稿，清扫时移除坏数据', () => {
    localStorage.setItem(draftKey('book_1', 'ch_1'), '{bad json');
    localStorage.setItem(draftKey('book_1', 'ch_2'), JSON.stringify({ foo: 'bar' }));
    expect(loadDraftSnap('book_1', 'ch_1')).toBeNull();
    expect(loadDraftSnap('book_1', 'ch_2')).toBeNull();
    const cleared = clearExpiredDrafts();
    expect(cleared).toBe(2);
    expect(collectDraftKeys()).toEqual([]);
  });

  it('TTL 清扫只清过期草稿，未过期与无关 key 保留', () => {
    const now = Date.now();
    // 过期：9 天前保存
    const expired = Math.floor((now - 9 * 24 * 60 * 60 * SECOND) / 1000);
    localStorage.setItem(
      draftKey('book_1', 'ch_old'),
      JSON.stringify({ html: '<p>x</p>', wordCount: 1, source: 'auto', savedAt: expired }),
    );
    // 未过期：刚刚保存
    saveDraftSnap('book_1', 'ch_new', '<p>y</p>', 1);
    // 无关 key：不属于草稿前缀
    localStorage.setItem('sight-folio:other', 'keep');
    expect(clearExpiredDrafts(now)).toBe(1);
    expect(loadDraftSnap('book_1', 'ch_old')).toBeNull();
    expect(loadDraftSnap('book_1', 'ch_new')).not.toBeNull();
    expect(localStorage.getItem('sight-folio:other')).toBe('keep');
  });

  it('savedAt 缺失（无法判定新旧）按过期处理，防止脏数据滞留', () => {
    localStorage.setItem(draftKey('book_1', 'ch_1'), JSON.stringify({ html: '<p>x</p>', wordCount: 1 }));
    expect(clearExpiredDrafts(Date.now())).toBe(1);
    expect(collectDraftKeys()).toEqual([]);
    expect(DRAFT_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
