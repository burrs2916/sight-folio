// writingDocsStore.closeTo —— L3 页签批量关闭（右键菜单：关闭其他/关闭所有）原子语义
//
// 2026-09-28 新增：closeTo 一次 set 完成批量关闭，避免逐条 closeTab 的中间态。
// 刻意复用 closeTab 的激活回退规则：激活页签被关 → 落到保留页签；全关 → 清除激活。
import { describe, it, expect, beforeEach } from 'vitest';
import { useWritingDocsStore } from '../writingDocsStore';

describe('writingDocsStore.closeTo（批量关闭）', () => {
  beforeEach(() => {
    useWritingDocsStore.setState({ tabs: {}, activeTab: {}, activeChapterByBook: {} });
  });

  function seed(containerId: string, count: number) {
    const tabs = Array.from({ length: count }, (_, i) => ({
      tabId: `tab-${i}`,
      chapterId: `ch-${i}`,
      name: `第 ${i + 1} 章`,
    }));
    useWritingDocsStore.setState((s) => ({
      tabs: { ...s.tabs, [containerId]: tabs },
      activeTab: { ...s.activeTab, [containerId]: tabs[0].tabId },
    }));
    return tabs;
  }

  it('keepTabId 缺省 = 关闭全部页签并清除激活', () => {
    const c = 'c1';
    seed(c, 3);
    useWritingDocsStore.getState().closeTo(c);
    const s = useWritingDocsStore.getState();
    expect(s.tabs[c]).toBeUndefined();
    expect(s.activeTab[c]).toBeUndefined();
  });

  it('keepTabId 提供 = 仅保留该页签，激活页签被关时落到保留页签', () => {
    const c = 'c1';
    const tabs = seed(c, 3);
    // 激活 = tab-0，关闭其他 → 保留 tab-2，激活应切到 tab-2
    useWritingDocsStore.getState().closeTo(c, { keepTabId: tabs[2].tabId });
    const s = useWritingDocsStore.getState();
    expect(s.tabs[c]?.map((t) => t.tabId)).toEqual(['tab-2']);
    expect(s.activeTab[c]).toBe('tab-2');
  });

  it('keepTabId 就是当前激活页签：只关其他，激活不动', () => {
    const c = 'c1';
    const tabs = seed(c, 3);
    useWritingDocsStore.getState().closeTo(c, { keepTabId: tabs[0].tabId });
    const s = useWritingDocsStore.getState();
    expect(s.tabs[c]?.map((t) => t.tabId)).toEqual(['tab-0']);
    expect(s.activeTab[c]).toBe('tab-0');
  });

  it('keepTabId 不在列表中：防御性 no-op', () => {
    const c = 'c1';
    const tabs = seed(c, 2);
    useWritingDocsStore.getState().closeTo(c, { keepTabId: 'no-such-tab' });
    const s = useWritingDocsStore.getState();
    expect(s.tabs[c]?.length).toBe(2);
    expect(s.tabs[c]?.[0]?.tabId).toBe(tabs[0].tabId);
    expect(s.activeTab[c]).toBe(tabs[0].tabId);
  });

  it('容器本就没有页签：no-op（不引入空条目）', () => {
    const c = 'ghost-container';
    useWritingDocsStore.getState().closeTo(c);
    const s = useWritingDocsStore.getState();
    expect(s.tabs[c]).toBeUndefined();
    expect(s.activeTab[c]).toBeUndefined();
  });

  it('单页签容器 closeTo 全部：清空；closeTo keep 自己：保留', () => {
    const c = 'c1';
    const tabs = seed(c, 1);
    useWritingDocsStore.getState().closeTo(c);
    expect(useWritingDocsStore.getState().tabs[c]).toBeUndefined();

    seed(c, 1);
    useWritingDocsStore.getState().closeTo(c, { keepTabId: tabs[0].tabId });
    const s = useWritingDocsStore.getState();
    expect(s.tabs[c]?.map((t) => t.tabId)).toEqual(['tab-0']);
  });
});
